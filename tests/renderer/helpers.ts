import { vi } from 'vitest';
import { DEFAULT_APPROVAL, DEFAULT_LIMITS, type AIState, type ModelInfo, type ProviderConfig, type TurnEvent } from '@shared/ai/types';
import type { AIAPI, AnimationAPI, AssetsAPI, ExportAPI, ProjectAPI, ScenesAPI } from '@shared/types/api';
import type { ProjectAsset } from '@shared/types/assets';
import type { AppErrorCode, IpcResult } from '@shared/types/errors';
import type { ExportProgress } from '@shared/types/export';
import type { ProjectMetadata, RecentProject } from '@shared/types/project';
import type { SceneCollection, SceneInfo } from '@shared/types/scenes';

export function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(message: string, code: AppErrorCode = 'UNKNOWN'): IpcResult<T> {
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

export type MockExportApi = { [K in keyof ExportAPI]: ReturnType<typeof vi.fn<ExportAPI[K]>> } & {
  /** Delivers a progress event to every subscriber, like the main process does. */
  emitProgress(progress: ExportProgress): void;
};

/** A mock export API: MP4 and GIF are available, a destination is always chosen and exports succeed. */
export function createMockExportApi(overrides: Partial<ExportAPI> = {}): MockExportApi {
  const listeners = new Set<(progress: ExportProgress) => void>();
  const api: MockExportApi = {
    getCapabilities: vi.fn<ExportAPI['getCapabilities']>(async () => ok({ animationFormats: ['mp4', 'gif'] })),
    chooseDestination: vi.fn<ExportAPI['chooseDestination']>(async () => ok({ id: 'destination-1', path: '/exports/output' })),
    startExport: vi.fn<ExportAPI['startExport']>(async () => ok({ outputPath: '/exports/output', fileCount: 1 })),
    cancelExport: vi.fn<ExportAPI['cancelExport']>(async () => ok(undefined)),
    revealOutput: vi.fn<ExportAPI['revealOutput']>(async () => ok(undefined)),
    onProgress: vi.fn<ExportAPI['onProgress']>((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emitProgress: (progress) => listeners.forEach((listener) => listener(progress))
  };
  for (const [key, impl] of Object.entries(overrides)) {
    (api as Record<string, unknown>)[key] = vi.fn(impl as (...args: never[]) => unknown);
  }
  return api;
}

export type MockAiApi = { [K in keyof AIAPI]: ReturnType<typeof vi.fn<AIAPI[K]>> } & {
  /** Delivers a streamed-text event to every subscriber, like the main process does. */
  emitTurn(event: TurnEvent): void;
  /** Replaces the state that later calls report, like a settings change in the main process. */
  setState(state: AIState): void;
};

export const PROVIDER: ProviderConfig = { id: 'provider-1', kind: 'openai', name: 'My OpenAI', baseUrl: null, credentialHint: '••••1234', manualModels: [] };

export function aiModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    providerId: PROVIDER.id,
    id: 'gpt-4o',
    displayName: 'gpt-4o',
    source: 'catalog',
    capabilities: { image: 'yes', tools: 'yes', streaming: 'yes', efforts: [], contextWindow: null },
    available: true,
    ...overrides
  };
}

/** An AI state with no providers, or with the given ones. */
export function aiState(models: ModelInfo[] = [], providers: ProviderConfig[] = models.length > 0 ? [PROVIDER] : []): AIState {
  return {
    settings: { providers, selection: null, efforts: {}, limits: { ...DEFAULT_LIMITS }, approval: { ...DEFAULT_APPROVAL }, mcpServers: [] },
    descriptors: [
      { kind: 'openai', label: 'OpenAI', authHelp: 'Needs an API key.', needsApiKey: true, customEndpoint: 'optional', defaultBaseUrl: 'https://api.openai.com/v1', available: true, unavailableReason: null },
      { kind: 'copilot', label: 'GitHub Copilot', authHelp: '', needsApiKey: false, customEndpoint: 'none', defaultBaseUrl: null, available: false, unavailableReason: 'No supported integration.' }
    ],
    models
  };
}

/** A stateful AI API: preferences are remembered and a turn answers "Done." unless overridden. */
export function createMockAiApi(initial: AIState = aiState(), overrides: Partial<AIAPI> = {}): MockAiApi {
  let state = initial;
  const listeners = new Set<(event: TurnEvent) => void>();
  const api: MockAiApi = {
    getState: vi.fn<AIAPI['getState']>(async () => ok(state)),
    saveProvider: vi.fn<AIAPI['saveProvider']>(async () => ok(state)),
    removeProvider: vi.fn<AIAPI['removeProvider']>(async () => ok(state)),
    disconnectProvider: vi.fn<AIAPI['disconnectProvider']>(async () => ok(state)),
    testProvider: vi.fn<AIAPI['testProvider']>(async () => ok({ modelCount: 3 })),
    refreshModels: vi.fn<AIAPI['refreshModels']>(async () => ok(state)),
    updatePreferences: vi.fn<AIAPI['updatePreferences']>(async (preferences) => {
      state = { ...state, settings: { ...state.settings, ...(preferences.selection !== undefined ? { selection: preferences.selection } : {}), efforts: { ...state.settings.efforts, ...preferences.efforts }, ...(preferences.limits !== undefined ? { limits: preferences.limits } : {}), ...(preferences.approval !== undefined ? { approval: preferences.approval } : {}) } };
      return ok(state);
    }),
    runTurn: vi.fn<AIAPI['runTurn']>(async () => ok({ text: 'Done.', toolCalls: [], stopReason: 'end' as const })),
    cancelTurn: vi.fn<AIAPI['cancelTurn']>(async () => ok(undefined)),
    onTurnEvent: vi.fn<AIAPI['onTurnEvent']>((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    listConversations: vi.fn<AIAPI['listConversations']>(async () => ok([])),
    loadConversation: vi.fn<AIAPI['loadConversation']>(async () => ok(null)),
    saveConversation: vi.fn<AIAPI['saveConversation']>(async () => ok(undefined)),
    renameConversation: vi.fn<AIAPI['renameConversation']>(async () => ok(undefined)),
    deleteConversation: vi.fn<AIAPI['deleteConversation']>(async () => ok(undefined)),
    clearConversations: vi.fn<AIAPI['clearConversations']>(async () => ok(0)),
    pickAttachments: vi.fn<AIAPI['pickAttachments']>(async () => ok({ attachments: [], rejected: [] })),
    listMcpServers: vi.fn<AIAPI['listMcpServers']>(async () => ok([])),
    saveMcpServer: vi.fn<AIAPI['saveMcpServer']>(async () => ok(state)),
    removeMcpServer: vi.fn<AIAPI['removeMcpServer']>(async () => ok(state)),
    connectMcpServer: vi.fn<AIAPI['connectMcpServer']>(async () => fail('No such server.')),
    disconnectMcpServer: vi.fn<AIAPI['disconnectMcpServer']>(async () => ok(null)),
    testMcpServer: vi.fn<AIAPI['testMcpServer']>(async () => fail('No such server.')),
    listMcpTools: vi.fn<AIAPI['listMcpTools']>(async () => ok([])),
    callMcpTool: vi.fn<AIAPI['callMcpTool']>(async () => ok({ text: '', isError: false })),
    emitTurn: (event) => listeners.forEach((listener) => listener(event)),
    setState: (next) => {
      state = next;
    }
  };
  for (const [key, impl] of Object.entries(overrides)) {
    (api as Record<string, unknown>)[key] = vi.fn(impl as (...args: never[]) => unknown);
  }
  return api;
}
