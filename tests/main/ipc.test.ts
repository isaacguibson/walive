import path from 'node:path';
import { access, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { ExportApplication, type DestinationRequest } from '@core/application/exportApplication';
import { JsonRecentProjectRepository } from '@core/application/jsonRecentProjectRepository';
import { ProjectApplication } from '@core/application/projectApplication';
import { RecentProjectsService } from '@core/application/recentProjectsService';
import { silentLogger } from '@core/logger';
import { ProjectService } from '@core/project/projectService';
import { ALLOWED_IPC_CHANNELS, IPC_CHANNELS } from '@shared/ipc/channels';
import type { IpcResult } from '@shared/types/errors';
import type { SceneCollection } from '@shared/types/scenes';
import { registerIpcHandlers, type AssetFilePicker, type DirectoryPicker } from '../../src/main/ipc/registerIpcHandlers';
import { makeTempDir } from '../helpers/tempDir';

type Listener = (event: unknown, payload?: unknown) => unknown;

async function setup(pickResult: string | null = null, pickedFiles: string[] = []) {
  const root = await makeTempDir();
  const projects = new ProjectService();
  const recents = new RecentProjectsService(new JsonRecentProjectRepository(path.join(root, 'state.json')), projects);
  const application = new ProjectApplication(projects, recents);

  const handlers = new Map<string, Listener>();
  const pick = vi.fn(async () => pickResult);
  const directoryPicker: DirectoryPicker = { pickDirectory: pick };
  const pickFiles = vi.fn(async () => pickedFiles);
  const assetPicker: AssetFilePicker = { pickFiles };
  const pickDestination = vi.fn(async (_request: DestinationRequest): Promise<string | null> => null);
  const reveal = vi.fn();
  const exports = new ExportApplication(projects, {
    picker: { pick: pickDestination },
    revealer: { reveal },
    publishProgress: vi.fn(),
    ffmpegPath: null
  });
  registerIpcHandlers({
    ipc: { handle: (channel, listener) => void handlers.set(channel, listener) },
    application,
    exports,
    directoryPicker,
    assetPicker,
    logger: silentLogger
  });

  async function invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler for ${channel}`);
    }
    return (await handler({}, payload)) as IpcResult<T>;
  }

  return { root, handlers, invoke, pick, pickFiles, projects, pickDestination, reveal };
}

async function firstSceneId(invoke: <T>(channel: string, payload?: unknown) => Promise<IpcResult<T>>): Promise<string> {
  const scenes = await invoke<SceneCollection>(IPC_CHANNELS.listScenes);
  if (!scenes.ok) {
    throw new Error('Scenes could not be listed');
  }
  return scenes.value.activeSceneId;
}

describe('IPC handlers', () => {
  it('registers exactly the explicitly defined channels', async () => {
    const { handlers } = await setup();
    expect([...handlers.keys()].sort()).toEqual(
      [
        'animation:load',
        'animation:save',
        'assets:delete',
        'assets:import',
        'assets:list',
        'assets:read-image',
        'assets:rename',
        'export:cancel',
        'export:capabilities',
        'export:destination',
        'export:reveal',
        'export:start',
        'project:close',
        'project:create',
        'project:get-recent',
        'project:open',
        'project:remove-recent',
        'project:select-directory',
        'scenes:create',
        'scenes:delete',
        'scenes:list',
        'scenes:rename',
        'scenes:select'
      ].sort()
    );
    expect([...handlers.keys()].sort()).toEqual([...ALLOWED_IPC_CHANNELS].sort());
  });

  it('stores and loads the animation of a scene through IPC', async () => {
    const { root, invoke } = await setup();
    await invoke(IPC_CHANNELS.createProject, { name: 'Anim', location: root, canvas: { width: 2, height: 2, keepAspectRatio: false } });
    const sceneId = await firstSceneId(invoke);
    expect(await invoke(IPC_CHANNELS.loadAnimation, { sceneId })).toEqual({ ok: true, value: null });

    const pixels = new Uint8Array(16).fill(255);
    const document = {
      width: 2,
      height: 2,
      frames: [{ id: 'f1', layers: [{ id: 'l1', name: 'Layer 1', visible: true, pixels }] }]
    };
    expect(await invoke(IPC_CHANNELS.saveAnimation, { sceneId, document })).toEqual({ ok: true, value: undefined });
    const loaded = await invoke<typeof document>(IPC_CHANNELS.loadAnimation, { sceneId });
    expect(loaded.ok && Array.from(loaded.value.frames[0]?.layers[0]?.pixels ?? [])).toEqual(Array.from(pixels));
  });

  it('rejects invalid animation payloads and requests without an open project', async () => {
    const { root, invoke } = await setup();
    expect(await invoke(IPC_CHANNELS.loadAnimation, { sceneId: 'x' })).toMatchObject({ ok: false, error: { code: 'NO_PROJECT_OPEN' } });

    await invoke(IPC_CHANNELS.createProject, { name: 'Anim', location: root, canvas: { width: 2, height: 2, keepAspectRatio: false } });
    const sceneId = await firstSceneId(invoke);
    const emptyDocument = { width: 2, height: 2, frames: [] };
    for (const payload of [undefined, {}, { sceneId }, { sceneId, document: 'x' }, { sceneId, document: emptyDocument }]) {
      expect(await invoke(IPC_CHANNELS.saveAnimation, payload)).toMatchObject({ ok: false });
    }
    expect(await invoke(IPC_CHANNELS.loadAnimation, {})).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(await invoke(IPC_CHANNELS.loadAnimation, { sceneId: '../x' })).toMatchObject({ ok: false, error: { code: 'SCENE_NOT_FOUND' } });
  });

  it('manages scenes through IPC and rejects invalid scene requests', async () => {
    const { root, invoke } = await setup();
    expect(await invoke(IPC_CHANNELS.listScenes)).toMatchObject({ ok: false, error: { code: 'NO_PROJECT_OPEN' } });
    await invoke(IPC_CHANNELS.createProject, { name: 'Scenes', location: root });

    const created = await invoke<SceneCollection>(IPC_CHANNELS.createScene, { name: 'Intro' });
    expect(created.ok && created.value.scenes.map((scene) => scene.name)).toEqual(['Scene 1', 'Intro']);
    const [first, intro] = created.ok ? created.value.scenes : [];
    expect(created.ok && created.value.activeSceneId).toBe(intro?.id);

    expect(await invoke(IPC_CHANNELS.renameScene, { sceneId: intro?.id, name: 'Opening' })).toMatchObject({ ok: true });
    expect(await invoke(IPC_CHANNELS.selectScene, { sceneId: first?.id })).toMatchObject({
      ok: true,
      value: { activeSceneId: first?.id }
    });
    expect(await invoke(IPC_CHANNELS.deleteScene, { sceneId: first?.id })).toMatchObject({
      ok: true,
      value: { activeSceneId: intro?.id }
    });
    expect(await invoke(IPC_CHANNELS.deleteScene, { sceneId: intro?.id })).toMatchObject({ ok: false, error: { code: 'LAST_SCENE' } });

    for (const channel of [IPC_CHANNELS.createScene, IPC_CHANNELS.renameScene, IPC_CHANNELS.deleteScene, IPC_CHANNELS.selectScene]) {
      expect(await invoke(channel, undefined)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
      expect(await invoke(channel, { sceneId: 3, name: 3 })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
  });

  it('creates, lists, closes, and reopens a project', async () => {
    const { root, invoke } = await setup();

    const created = await invoke<{ name: string }>(IPC_CHANNELS.createProject, { name: 'Via IPC', location: root });
    expect(created).toMatchObject({ ok: true, value: { name: 'Via IPC' } });

    expect(await invoke(IPC_CHANNELS.closeProject)).toEqual({ ok: true, value: undefined });

    const recent = await invoke<{ path: string; available: boolean }[]>(IPC_CHANNELS.getRecentProjects);
    expect(recent.ok && recent.value).toHaveLength(1);

    const projectPath = recent.ok ? recent.value[0]?.path : undefined;
    const reopened = await invoke(IPC_CHANNELS.openProject, { path: projectPath });
    expect(reopened).toMatchObject({ ok: true, value: { name: 'Via IPC' } });
  });

  it('shows the native dialog in the main process when no path is given', async () => {
    const first = await setup();
    await first.invoke(IPC_CHANNELS.createProject, { name: 'Dialog', location: first.root });
    const projectPath = path.join(first.root, 'Dialog');

    const { invoke, pick } = await setup(projectPath);
    const result = await invoke(IPC_CHANNELS.openProject, {});
    expect(pick).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, value: { name: 'Dialog' } });
  });

  it('resolves to null when the dialog is cancelled', async () => {
    const { invoke, pick } = await setup(null);
    expect(await invoke(IPC_CHANNELS.openProject)).toEqual({ ok: true, value: null });
    expect(pick).toHaveBeenCalledOnce();
  });

  it('does not use the dialog when a path is supplied', async () => {
    const { invoke, pick, root } = await setup();
    await invoke(IPC_CHANNELS.openProject, { path: root });
    expect(pick).not.toHaveBeenCalled();
  });

  it('returns user-safe errors for invalid projects', async () => {
    const { invoke, root } = await setup();
    const result = await invoke(IPC_CHANNELS.openProject, { path: root });
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_A_PROJECT', message: 'The selected folder is not a valid Animation Studio project.' }
    });
  });

  it('does not leak raw filesystem errors or stack traces', async () => {
    const { invoke, root } = await setup();
    const result = await invoke(IPC_CHANNELS.createProject, { name: 'ok', location: path.join(root, 'state.json') });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/ENOENT|EACCES|ENOTDIR|EEXIST|at .*\.ts/);
  });

  it('rejects malformed payloads', async () => {
    const { invoke } = await setup();
    for (const [channel, payload] of [
      [IPC_CHANNELS.createProject, undefined],
      [IPC_CHANNELS.createProject, { name: 1, location: 2 }],
      [IPC_CHANNELS.openProject, { path: 5 }],
      [IPC_CHANNELS.removeRecentProject, {}]
    ] as const) {
      const result = await invoke(channel, payload);
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
  });

  it('removes a recent project through IPC', async () => {
    const { invoke, root } = await setup();
    await invoke(IPC_CHANNELS.createProject, { name: 'ToRemove', location: root });
    const recent = await invoke<{ projectId: string }[]>(IPC_CHANNELS.getRecentProjects);
    const projectId = recent.ok ? recent.value[0]?.projectId : undefined;

    expect(await invoke(IPC_CHANNELS.removeRecentProject, { projectId })).toEqual({ ok: true, value: undefined });
    expect(await invoke(IPC_CHANNELS.getRecentProjects)).toEqual({ ok: true, value: [] });
  });

  it('manages project assets through IPC, with the file dialog shown only in the main process', async () => {
    const sourceDir = await makeTempDir('animation-studio-sources-');
    const sourceFile = path.join(sourceDir, 'hero.png');
    await writeFile(sourceFile, 'x');
    const { invoke, root, pickFiles } = await setup(null, [sourceFile]);

    expect(await invoke(IPC_CHANNELS.listAssets)).toMatchObject({ ok: false, error: { code: 'NO_PROJECT_OPEN' } });
    await invoke(IPC_CHANNELS.createProject, { name: 'Assets', location: root });

    const imported = await invoke<{ imported: { id: string }[]; skipped: unknown[] }>(IPC_CHANNELS.importAssets);
    expect(pickFiles).toHaveBeenCalledOnce();
    expect(imported).toMatchObject({ ok: true, value: { imported: [{ id: 'assets/images/hero.png' }], skipped: [] } });

    expect(await invoke(IPC_CHANNELS.listAssets)).toMatchObject({ ok: true, value: [{ name: 'hero.png', type: 'image' }] });
    expect(await invoke(IPC_CHANNELS.renameAsset, { assetId: 'assets/images/hero.png', newName: 'villain' })).toMatchObject({
      ok: true,
      value: { name: 'villain.png' }
    });
    expect(await invoke(IPC_CHANNELS.deleteAsset, { assetId: 'assets/images/villain.png' })).toEqual({ ok: true, value: undefined });
    expect(await invoke(IPC_CHANNELS.listAssets)).toEqual({ ok: true, value: [] });
  });

  it('does not import anything when the asset dialog is cancelled', async () => {
    const { invoke, root } = await setup(null, []);
    await invoke(IPC_CHANNELS.createProject, { name: 'Assets', location: root });
    expect(await invoke(IPC_CHANNELS.importAssets)).toEqual({ ok: true, value: { imported: [], skipped: [] } });
  });

  it('rejects malformed asset payloads', async () => {
    const { invoke } = await setup();
    for (const [channel, payload] of [
      [IPC_CHANNELS.renameAsset, undefined],
      [IPC_CHANNELS.renameAsset, { assetId: 1, newName: 'x' }],
      [IPC_CHANNELS.renameAsset, { assetId: 'a' }],
      [IPC_CHANNELS.deleteAsset, {}]
    ] as const) {
      expect(await invoke(channel, payload)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
  });
});

describe('export IPC handlers', () => {
  const query = { kind: 'current-frame', scope: 'active', format: 'gif', suggestedName: 'My Scene: frame 1' };

  async function setupWithFrame() {
    const context = await setup();
    await context.invoke(IPC_CHANNELS.createProject, { name: 'Export', location: context.root, canvas: { width: 2, height: 2, keepAspectRatio: false } });
    const sceneId = await firstSceneId(context.invoke);
    const pixels = new Uint8Array(16).fill(255);
    const document = { width: 2, height: 2, frames: [{ id: 'f1', layers: [{ id: 'l1', name: 'Layer 1', visible: true, pixels }] }] };
    await context.invoke(IPC_CHANNELS.saveAnimation, { sceneId, document });
    return context;
  }

  it('only offers GIF when no MP4 encoder is bundled', async () => {
    const { invoke } = await setup();
    expect(await invoke(IPC_CHANNELS.exportCapabilities)).toEqual({ ok: true, value: { animationFormats: ['gif'] } });
  });

  it('asks the native dialog for a sanitized file name and keeps the path in the main process', async () => {
    const { invoke, pickDestination, root } = await setup();
    pickDestination.mockResolvedValueOnce(path.join(root, 'frame.png'));
    const result = await invoke<{ id: string; path: string }>(IPC_CHANNELS.exportDestination, query);
    expect(pickDestination).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file', suggestedName: 'My_Scene_frame_1.png', extension: 'png' }));
    expect(result).toMatchObject({ ok: true, value: { path: path.join(root, 'frame.png') } });

    pickDestination.mockResolvedValueOnce(null);
    expect(await invoke(IPC_CHANNELS.exportDestination, query)).toEqual({ ok: true, value: null });
    pickDestination.mockResolvedValueOnce('relative/frame.png');
    expect(await invoke(IPC_CHANNELS.exportDestination, query)).toMatchObject({ ok: false, error: { code: 'INVALID_LOCATION' } });
  });

  it('rejects malformed destination queries and export requests', async () => {
    const { invoke, pickDestination } = await setup();
    for (const payload of [undefined, {}, { ...query, kind: 'avi' }, { ...query, suggestedName: 3 }, { ...query, scope: 'some' }]) {
      expect(await invoke(IPC_CHANNELS.exportDestination, payload)).toMatchObject({ ok: false, error: { code: 'INVALID_EXPORT' } });
    }
    expect(pickDestination).not.toHaveBeenCalled();
    for (const payload of [undefined, 'x', {}, { kind: 'current-frame', destinationId: '../x', overwrite: false, frameId: 'f1' }]) {
      expect(await invoke(IPC_CHANNELS.exportStart, payload)).toMatchObject({ ok: false, error: { code: 'INVALID_EXPORT' } });
    }
  });

  it('refuses to export to a destination the user never approved, whatever the request claims', async () => {
    const { invoke, root } = await setupWithFrame();
    const forged = { kind: 'current-frame', destinationId: 'forged', overwrite: true, frameId: 'f1', path: path.join(root, 'evil.png') };
    expect(await invoke(IPC_CHANNELS.exportStart, forged)).toMatchObject({ ok: false, error: { code: 'INVALID_EXPORT' } });
    await expect(access(path.join(root, 'evil.png'))).rejects.toThrow();
  });

  it('exports to the approved destination and then reveals it', async () => {
    const { invoke, pickDestination, reveal, root } = await setupWithFrame();
    expect(await invoke(IPC_CHANNELS.exportReveal)).toMatchObject({ ok: false, error: { code: 'INVALID_EXPORT' } });

    const target = path.join(root, 'out.png');
    pickDestination.mockResolvedValueOnce(target);
    const destination = await invoke<{ id: string }>(IPC_CHANNELS.exportDestination, query);
    const id = destination.ok ? destination.value.id : '';
    const request = { kind: 'current-frame', destinationId: id, overwrite: false, frameId: 'f1' };
    expect(await invoke(IPC_CHANNELS.exportStart, request)).toEqual({ ok: true, value: { outputPath: target, fileCount: 1 } });
    await expect(access(target)).resolves.toBeUndefined();

    expect(await invoke(IPC_CHANNELS.exportReveal)).toEqual({ ok: true, value: undefined });
    expect(reveal).toHaveBeenCalledWith(target);

    expect(await invoke(IPC_CHANNELS.exportStart, request)).toMatchObject({ ok: false, error: { code: 'EXPORT_CONFLICT' } });
  });
});
