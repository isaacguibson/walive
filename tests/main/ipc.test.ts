import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { JsonRecentProjectRepository } from '@core/application/jsonRecentProjectRepository';
import { ProjectApplication } from '@core/application/projectApplication';
import { RecentProjectsService } from '@core/application/recentProjectsService';
import { silentLogger } from '@core/logger';
import { ProjectService } from '@core/project/projectService';
import { ALLOWED_IPC_CHANNELS, IPC_CHANNELS } from '@shared/ipc/channels';
import type { IpcResult } from '@shared/types/errors';
import { registerIpcHandlers, type DirectoryPicker } from '../../src/main/ipc/registerIpcHandlers';
import { makeTempDir } from '../helpers/tempDir';

type Listener = (event: unknown, payload?: unknown) => unknown;

async function setup(pickResult: string | null = null) {
  const root = await makeTempDir();
  const projects = new ProjectService();
  const recents = new RecentProjectsService(new JsonRecentProjectRepository(path.join(root, 'state.json')), projects);
  const application = new ProjectApplication(projects, recents);

  const handlers = new Map<string, Listener>();
  const pick = vi.fn(async () => pickResult);
  const directoryPicker: DirectoryPicker = { pickDirectory: pick };
  registerIpcHandlers({
    ipc: { handle: (channel, listener) => void handlers.set(channel, listener) },
    application,
    directoryPicker,
    logger: silentLogger
  });

  async function invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler for ${channel}`);
    }
    return (await handler({}, payload)) as IpcResult<T>;
  }

  return { root, handlers, invoke, pick, projects };
}

describe('IPC handlers', () => {
  it('registers exactly the explicitly defined channels', async () => {
    const { handlers } = await setup();
    expect([...handlers.keys()].sort()).toEqual(
      [
        'animation:load',
        'animation:save',
        'project:close',
        'project:create',
        'project:get-recent',
        'project:open',
        'project:remove-recent',
        'project:select-directory'
      ].sort()
    );
    expect([...handlers.keys()].sort()).toEqual([...ALLOWED_IPC_CHANNELS].sort());
  });

  it('stores and loads the animation of the open project through IPC', async () => {
    const { root, invoke } = await setup();
    await invoke(IPC_CHANNELS.createProject, { name: 'Anim', location: root, canvas: { width: 2, height: 2, keepAspectRatio: false } });
    expect(await invoke(IPC_CHANNELS.loadAnimation)).toEqual({ ok: true, value: null });

    const pixels = new Uint8Array(16).fill(255);
    const document = {
      width: 2,
      height: 2,
      frames: [{ id: 'f1', layers: [{ id: 'l1', name: 'Layer 1', visible: true, pixels }] }]
    };
    expect(await invoke(IPC_CHANNELS.saveAnimation, { document })).toEqual({ ok: true, value: undefined });
    const loaded = await invoke<typeof document>(IPC_CHANNELS.loadAnimation);
    expect(loaded.ok && Array.from(loaded.value.frames[0]?.layers[0]?.pixels ?? [])).toEqual(Array.from(pixels));
  });

  it('rejects invalid animation payloads and requests without an open project', async () => {
    const { root, invoke } = await setup();
    expect(await invoke(IPC_CHANNELS.loadAnimation)).toMatchObject({ ok: false, error: { code: 'NO_PROJECT_OPEN' } });

    await invoke(IPC_CHANNELS.createProject, { name: 'Anim', location: root, canvas: { width: 2, height: 2, keepAspectRatio: false } });
    for (const payload of [undefined, {}, { document: 'x' }, { document: { width: 2, height: 2, frames: [] } }]) {
      expect(await invoke(IPC_CHANNELS.saveAnimation, payload)).toMatchObject({ ok: false });
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
});
