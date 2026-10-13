import { vi } from 'vitest';
import type { AnimationAPI, AssetsAPI, ProjectAPI, ScenesAPI } from '@shared/types/api';
import type { ProjectAsset } from '@shared/types/assets';
import type { IpcResult } from '@shared/types/errors';
import type { ProjectMetadata, RecentProject } from '@shared/types/project';
import type { SceneCollection, SceneInfo } from '@shared/types/scenes';

export function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(message: string, code: 'UNKNOWN' | 'NOT_A_PROJECT' = 'UNKNOWN'): IpcResult<T> {
  return { ok: false, error: { code, message } };
}

export function metadata(name: string): ProjectMetadata {
  return {
    formatVersion: 1,
    id: `id-${name}`,
    name,
    createdAt: '2026-10-06T12:00:00.000Z',
    updatedAt: '2026-10-06T12:00:00.000Z',
    canvas: {
      width: 1920,
      height: 1080,
      keepAspectRatio: false
    }
  };
}

export function recent(name: string, overrides: Partial<RecentProject> = {}): RecentProject {
  return {
    projectId: `id-${name}`,
    name,
    path: `/projects/${name}`,
    lastOpenedAt: new Date().toISOString(),
    available: true,
    ...overrides
  };
}

export type MockProjectApi = { [K in keyof ProjectAPI]: ReturnType<typeof vi.fn<ProjectAPI[K]>> };

/** A mock preload API; every call resolves successfully unless overridden. */
export function createMockApi(overrides: Partial<ProjectAPI> = {}): MockProjectApi {
  const api: MockProjectApi = {
    createProject: vi.fn<ProjectAPI['createProject']>(async (name) => ok(metadata(name))),
    openProject: vi.fn<ProjectAPI['openProject']>(async () => ok(metadata('Opened'))),
    getRecentProjects: vi.fn<ProjectAPI['getRecentProjects']>(async () => ok([])),
    removeRecentProject: vi.fn<ProjectAPI['removeRecentProject']>(async () => ok(undefined)),
    closeProject: vi.fn<ProjectAPI['closeProject']>(async () => ok(undefined)),
    selectDirectory: vi.fn<ProjectAPI['selectDirectory']>(async () => ok('/chosen/location'))
  };
  for (const [key, impl] of Object.entries(overrides)) {
    (api as Record<string, unknown>)[key] = vi.fn(impl as (...args: never[]) => unknown);
  }
  return api;
}

export type MockAssetsApi = { [K in keyof AssetsAPI]: ReturnType<typeof vi.fn<AssetsAPI[K]>> };

/** A mock asset API; by default the project has no assets and every operation succeeds. */
export function createMockAssetsApi(overrides: Partial<AssetsAPI> = {}): MockAssetsApi {
  const placeholder: ProjectAsset = {
    id: 'assets/images/new.png',
    name: 'new.png',
    type: 'image',
    relativePath: 'assets/images/new.png',
    extension: 'png'
  };
  const api: MockAssetsApi = {
    listAssets: vi.fn<AssetsAPI['listAssets']>(async () => ok([])),
    readAssetImage: vi.fn<AssetsAPI['readAssetImage']>(async () => ok('data:image/png;base64,')),
    importAssets: vi.fn<AssetsAPI['importAssets']>(async () => ok({ imported: [], skipped: [] })),
    renameAsset: vi.fn<AssetsAPI['renameAsset']>(async () => ok(placeholder)),
    deleteAsset: vi.fn<AssetsAPI['deleteAsset']>(async () => ok(undefined))
  };
  for (const [key, impl] of Object.entries(overrides)) {
    (api as Record<string, unknown>)[key] = vi.fn(impl as (...args: never[]) => unknown);
  }
  return api;
}

export type MockAnimationApi = { [K in keyof AnimationAPI]: ReturnType<typeof vi.fn<AnimationAPI[K]>> };

/** A mock animation persistence API; by default nothing is stored and saving succeeds. */
export function createMockAnimationApi(overrides: Partial<AnimationAPI> = {}): MockAnimationApi {
  const api: MockAnimationApi = {
    loadAnimation: vi.fn<AnimationAPI['loadAnimation']>(async () => ok(null)),
    saveAnimation: vi.fn<AnimationAPI['saveAnimation']>(async () => ok(undefined))
  };
  for (const [key, impl] of Object.entries(overrides)) {
    (api as Record<string, unknown>)[key] = vi.fn(impl as (...args: never[]) => unknown);
  }
  return api;
}

export type MockScenesApi = { [K in keyof ScenesAPI]: ReturnType<typeof vi.fn<ScenesAPI[K]>> };

/** A stateful scene API: the project starts with the given scenes and the first one is active. */
export function createMockScenesApi(names: string[] = ['Scene 1']): MockScenesApi {
  let counter = 0;
  const makeScene = (name: string): SceneInfo => {
    counter += 1;
    return { id: `scene-${counter}`, name, createdAt: '2026-10-06T12:00:00.000Z', updatedAt: '2026-10-06T12:00:00.000Z' };
  };
  let scenes = names.map(makeScene);
  let activeSceneId = scenes[0]?.id ?? '';
  const collection = (): SceneCollection => ({ scenes: [...scenes], activeSceneId });
  const validate = (name: string, ignoredId?: string): string | null => {
    const trimmed = name.trim();
    if (trimmed === '') {
      return 'Enter a scene name.';
    }
    const duplicate = scenes.some((scene) => scene.id !== ignoredId && scene.name.toLowerCase() === trimmed.toLowerCase());
    return duplicate ? 'A scene with this name already exists.' : null;
  };

  return {
    listScenes: vi.fn<ScenesAPI['listScenes']>(async () => ok(collection())),
    createScene: vi.fn<ScenesAPI['createScene']>(async (name) => {
      const error = validate(name);
      if (error !== null) {
        return fail(error);
      }
      const scene = makeScene(name.trim());
      scenes = [...scenes, scene];
      activeSceneId = scene.id;
      return ok(collection());
    }),
    renameScene: vi.fn<ScenesAPI['renameScene']>(async (sceneId, name) => {
      const error = validate(name, sceneId);
      if (error !== null) {
        return fail(error);
      }
      scenes = scenes.map((scene) => (scene.id === sceneId ? { ...scene, name: name.trim() } : scene));
      return ok(collection());
    }),
    deleteScene: vi.fn<ScenesAPI['deleteScene']>(async (sceneId) => {
      const index = scenes.findIndex((scene) => scene.id === sceneId);
      scenes = scenes.filter((scene) => scene.id !== sceneId);
      if (activeSceneId === sceneId) {
        activeSceneId = (scenes[index] ?? scenes[index - 1])?.id ?? '';
      }
      return ok(collection());
    }),
    selectScene: vi.fn<ScenesAPI['selectScene']>(async (sceneId) => {
      activeSceneId = sceneId;
      return ok(collection());
    })
  };
}
