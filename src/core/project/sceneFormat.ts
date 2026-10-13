import { ID_PATTERN } from './animationFormat';
import { normalizeSceneName } from './names';
import { AppError } from '../errors';
import type { SceneCollection, SceneInfo } from '@shared/types/scenes';

export const SCENE_REGISTRY_FORMAT_VERSION = 1;

const MAX_SCENES = 1000;

export interface SceneRegistryFile extends SceneCollection {
  formatVersion: number;
}

function invalid(message = 'The scene list is not valid.'): AppError {
  return new AppError('INVALID_SCENE_DATA', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw invalid();
  }
  return value;
}

function parseScene(raw: unknown): SceneInfo {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) {
    throw invalid();
  }
  let name: string;
  try {
    name = normalizeSceneName(raw.name);
  } catch {
    throw invalid();
  }
  return { id: raw.id, name, createdAt: parseTimestamp(raw.createdAt), updatedAt: parseTimestamp(raw.updatedAt) };
}

/**
 * Validates the scene registry read from disk. A missing or unknown active
 * scene is not an error: it falls back to the first scene so the project can
 * always be opened. An empty list is returned as is (the caller creates one).
 */
export function parseSceneRegistry(input: unknown): SceneCollection {
  if (!isRecord(input) || input.formatVersion !== SCENE_REGISTRY_FORMAT_VERSION) {
    throw invalid('The scene list uses an unsupported format.');
  }
  if (!Array.isArray(input.scenes) || input.scenes.length > MAX_SCENES) {
    throw invalid();
  }
  const scenes = input.scenes.map(parseScene);
  if (new Set(scenes.map((scene) => scene.id)).size !== scenes.length) {
    throw invalid();
  }
  const activeSceneId = scenes.some((scene) => scene.id === input.activeSceneId)
    ? (input.activeSceneId as string)
    : (scenes[0]?.id ?? '');
  return { scenes, activeSceneId };
}

export function toSceneRegistryFile(collection: SceneCollection): SceneRegistryFile {
  return { formatVersion: SCENE_REGISTRY_FORMAT_VERSION, ...collection };
}
