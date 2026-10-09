import { vi } from 'vitest';
import type { AnimationAPI, ProjectAPI } from '@shared/types/api';
import type { IpcResult } from '@shared/types/errors';
import type { ProjectMetadata, RecentProject } from '@shared/types/project';

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
