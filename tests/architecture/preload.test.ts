import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc/channels';

const { exposeInMainWorld, invoke } = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn() }));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke }
}));

type Api = Record<string, (...args: unknown[]) => Promise<unknown>>;

async function loadFullApi(): Promise<{ project: Api; animation: Api; scenes: Api; assets: Api }> {
  vi.resetModules();
  exposeInMainWorld.mockClear();
  await import('../../src/preload/preload');
  const [name, api] = exposeInMainWorld.mock.calls[0] as [string, { project: Api; animation: Api; scenes: Api; assets: Api }];
  expect(name).toBe('api');
  return api;
}

async function loadApi(): Promise<Api> {
  return (await loadFullApi()).project;
}

describe('preload API', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ ok: true, value: undefined });
  });

  it('exposes a single "api" object with only the project, animation, scene and asset operations', async () => {
    const { project, animation, scenes, assets } = await loadFullApi();
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [, api] = exposeInMainWorld.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(api).sort()).toEqual(['animation', 'assets', 'project', 'scenes']);
    expect(Object.keys(scenes).sort()).toEqual(['createScene', 'deleteScene', 'listScenes', 'renameScene', 'selectScene']);
    expect(Object.keys(assets).sort()).toEqual(['deleteAsset', 'importAssets', 'listAssets', 'readAssetImage', 'renameAsset']);
    expect(Object.keys(animation).sort()).toEqual(['loadAnimation', 'saveAnimation']);
    expect(Object.keys(project).sort()).toEqual([
      'closeProject',
      'createProject',
      'getRecentProjects',
      'openProject',
      'removeRecentProject',
      'selectDirectory'
    ]);
  });

  it('routes each operation through its explicit IPC channel', async () => {
    const project = await loadApi();

    await project['createProject']?.('Name', '/loc');
    await project['openProject']?.('/some/path');
    await project['openProject']?.();
    await project['getRecentProjects']?.();
    await project['removeRecentProject']?.('id-1');
    await project['closeProject']?.();
    await project['selectDirectory']?.();

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.createProject, { name: 'Name', location: '/loc' }],
      [IPC_CHANNELS.openProject, { path: '/some/path' }],
      [IPC_CHANNELS.openProject, {}],
      [IPC_CHANNELS.getRecentProjects, undefined],
      [IPC_CHANNELS.removeRecentProject, { projectId: 'id-1' }],
      [IPC_CHANNELS.closeProject, undefined],
      [IPC_CHANNELS.selectDirectory, undefined]
    ]);
  });

  it('routes animation operations through their explicit IPC channels', async () => {
    const { animation } = await loadFullApi();
    const document = { width: 1, height: 1, frames: [] };
    await animation['loadAnimation']?.('scene-1');
    await animation['saveAnimation']?.('scene-1', document);
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.loadAnimation, { sceneId: 'scene-1' }],
      [IPC_CHANNELS.saveAnimation, { sceneId: 'scene-1', document }]
    ]);
  });

  it('routes scene operations through their explicit IPC channels', async () => {
    const { scenes } = await loadFullApi();
    await scenes['listScenes']?.();
    await scenes['createScene']?.('Intro');
    await scenes['renameScene']?.('scene-1', 'Opening');
    await scenes['deleteScene']?.('scene-1');
    await scenes['selectScene']?.('scene-2');
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.listScenes, undefined],
      [IPC_CHANNELS.createScene, { name: 'Intro' }],
      [IPC_CHANNELS.renameScene, { sceneId: 'scene-1', name: 'Opening' }],
      [IPC_CHANNELS.deleteScene, { sceneId: 'scene-1' }],
      [IPC_CHANNELS.selectScene, { sceneId: 'scene-2' }]
    ]);
  });

  it('routes asset operations through their explicit IPC channels', async () => {
    const { assets } = await loadFullApi();
    await assets['listAssets']?.();
    await assets['readAssetImage']?.('assets/images/a.png');
    await assets['importAssets']?.();
    await assets['renameAsset']?.('assets/images/a.png', 'b');
    await assets['deleteAsset']?.('assets/images/a.png');
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.listAssets, undefined],
      [IPC_CHANNELS.readAssetImage, { assetId: 'assets/images/a.png' }],
      [IPC_CHANNELS.importAssets, undefined],
      [IPC_CHANNELS.renameAsset, { assetId: 'assets/images/a.png', newName: 'b' }],
      [IPC_CHANNELS.deleteAsset, { assetId: 'assets/images/a.png' }]
    ]);
  });

  it('turns IPC transport failures into error results instead of rejecting', async () => {
    invoke.mockRejectedValue(new Error('boom: /secret/path'));
    const project = await loadApi();
    const result = await project['getRecentProjects']?.();
    expect(result).toMatchObject({ ok: false, error: { code: 'IPC_FAILURE' } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('does not expose ipcRenderer or a generic invoke', async () => {
    const project = await loadApi();
    expect(project).not.toHaveProperty('invoke');
    expect(project).not.toHaveProperty('send');
    expect(project).not.toHaveProperty('ipcRenderer');
  });
});
