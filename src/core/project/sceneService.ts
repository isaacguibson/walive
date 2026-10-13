import { randomUUID } from 'node:crypto';
import { parseAnimationManifest } from './animationFormat';
import { DEFAULT_SCENE_NAME } from './constants';
import { normalizeSceneName } from './names';
import type { ProjectRepository } from './projectRepository';
import { layerFilesOf, readSceneAnimation, writeSceneAnimation } from './sceneAnimation';
import { parseSceneRegistry, toSceneRegistryFile } from './sceneFormat';
import type { OpenProject } from './types';
import { AppError } from '../errors';
import type { AnimationDocument } from '@shared/types/animation';
import type { SceneCollection, SceneInfo } from '@shared/types/scenes';

export interface SceneServiceOptions {
  repository: ProjectRepository;
  /** Resolves the open project, throwing when there is none. */
  requireProject(): OpenProject;
  now(): Date;
}

/**
 * Scenes of the open project and the animation each one stores. The registry
 * (`scenes/scenes.json`) is the single source of truth for which scenes exist,
 * their order and the active one. Layer pixels live in a content-addressed pool
 * shared by all scenes, so they are only removed when no scene refers to them.
 */
export class SceneService {
  private readonly repository: ProjectRepository;
  private readonly requireProject: () => OpenProject;
  private readonly now: () => Date;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: SceneServiceOptions) {
    this.repository = options.repository;
    this.requireProject = options.requireProject;
    this.now = options.now;
  }

  /** Scenes in creation order. Creates the first scene of projects that have none (including legacy ones). */
  listScenes(): Promise<SceneCollection> {
    return this.exclusive(() => this.readRegistry(this.requireProject().path));
  }

  /** Adds a scene and makes it the active one. */
  createScene(name: string): Promise<SceneCollection> {
    return this.exclusive(async () => {
      const { path: projectPath } = this.requireProject();
      const registry = await this.readRegistry(projectPath);
      const timestamp = this.now().toISOString();
      const scene: SceneInfo = {
        id: randomUUID(),
        name: this.validateName(name, registry.scenes),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      return this.writeRegistry(projectPath, { scenes: [...registry.scenes, scene], activeSceneId: scene.id });
    });
  }

  /** Changes the name only; the identifier and the stored animation stay as they are. */
  renameScene(sceneId: string, name: string): Promise<SceneCollection> {
    return this.exclusive(async () => {
      const { path: projectPath } = this.requireProject();
      const registry = await this.readRegistry(projectPath);
      this.requireScene(registry, sceneId);
      const newName = this.validateName(name, registry.scenes, sceneId);
      return this.writeRegistry(projectPath, this.touch(registry, sceneId, { name: newName }));
    });
  }

  /** Removes a scene. When it was the active one, the next scene (else the previous one) becomes active. */
  deleteScene(sceneId: string): Promise<SceneCollection> {
    return this.exclusive(async () => {
      const { path: projectPath } = this.requireProject();
      const registry = await this.readRegistry(projectPath);
      this.requireScene(registry, sceneId);
      const index = registry.scenes.findIndex((scene) => scene.id === sceneId);
      const scenes = registry.scenes.filter((scene) => scene.id !== sceneId);
      const neighbor = scenes[Math.min(index, scenes.length - 1)];
      if (neighbor === undefined) {
        throw new AppError('LAST_SCENE', 'A project must keep at least one scene.');
      }
      const activeSceneId = registry.activeSceneId === sceneId ? neighbor.id : registry.activeSceneId;
      // The registry goes first: a scene that fails to be unlisted is never half-deleted.
      const collection = await this.writeRegistry(projectPath, { scenes, activeSceneId });
      await this.repository.removeSceneFiles(projectPath, sceneId);
      await this.removeUnusedLayerFiles(projectPath, scenes);
      return collection;
    });
  }

  selectScene(sceneId: string): Promise<SceneCollection> {
    return this.exclusive(async () => {
      const { path: projectPath } = this.requireProject();
      const registry = await this.readRegistry(projectPath);
      this.requireScene(registry, sceneId);
      return registry.activeSceneId === sceneId ? registry : this.writeRegistry(projectPath, { ...registry, activeSceneId: sceneId });
    });
  }

  /** Reads the animation of a scene. Resolves to `null` when nothing has been saved in it yet. */
  loadAnimation(sceneId: string): Promise<AnimationDocument | null> {
    return this.exclusive(async () => {
      const { path: projectPath, metadata } = this.requireProject();
      this.requireScene(await this.readRegistry(projectPath), sceneId);
      return readSceneAnimation(this.repository, projectPath, sceneId, metadata.canvas);
    });
  }

  saveAnimation(sceneId: string, input: unknown): Promise<void> {
    return this.exclusive(async () => {
      const { path: projectPath, metadata } = this.requireProject();
      const registry = await this.readRegistry(projectPath);
      this.requireScene(registry, sceneId);
      await writeSceneAnimation(this.repository, projectPath, sceneId, metadata.canvas, input);
      const updated = await this.writeRegistry(projectPath, this.touch(registry, sceneId, {}));
      await this.removeUnusedLayerFiles(projectPath, updated.scenes);
    });
  }

  /** Runs operations one at a time: each one reads and rewrites the registry. */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async readRegistry(projectPath: string): Promise<SceneCollection> {
    const raw = await this.repository.readSceneRegistry(projectPath);
    if (raw !== null) {
      const registry = parseSceneRegistry(raw);
      if (registry.scenes.length > 0) {
        return registry;
      }
    }
    return this.createFirstScene(projectPath);
  }

  /** Creates the first scene, adopting the single animation older projects kept in `drawings/`. */
  private async createFirstScene(projectPath: string): Promise<SceneCollection> {
    const timestamp = this.now().toISOString();
    const scene: SceneInfo = { id: randomUUID(), name: DEFAULT_SCENE_NAME, createdAt: timestamp, updatedAt: timestamp };
    const legacy = await this.repository.readLegacyAnimationManifest(projectPath);
    if (legacy !== null) {
      await this.repository.writeAnimationManifest(projectPath, scene.id, parseAnimationManifest(legacy));
    }
    const collection = await this.writeRegistry(projectPath, { scenes: [scene], activeSceneId: scene.id });
    if (legacy !== null) {
      await this.repository.removeLegacyAnimationManifest(projectPath);
    }
    return collection;
  }

  private async writeRegistry(projectPath: string, collection: SceneCollection): Promise<SceneCollection> {
    await this.repository.writeSceneRegistry(projectPath, toSceneRegistryFile(collection));
    return collection;
  }

  private touch(registry: SceneCollection, sceneId: string, changes: Partial<Pick<SceneInfo, 'name'>>): SceneCollection {
    const updatedAt = this.now().toISOString();
    return {
      ...registry,
      scenes: registry.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...changes, updatedAt } : scene))
    };
  }

  /** Scene ids become path segments, so only ids present in the validated registry are accepted. */
  private requireScene(registry: SceneCollection, sceneId: unknown): void {
    if (!registry.scenes.some((scene) => scene.id === sceneId)) {
      throw new AppError('SCENE_NOT_FOUND', 'The scene could not be found.');
    }
  }

  private validateName(name: unknown, scenes: readonly SceneInfo[], exceptSceneId?: string): string {
    const normalized = normalizeSceneName(name);
    const key = normalized.toLowerCase();
    if (scenes.some((scene) => scene.id !== exceptSceneId && scene.name.toLowerCase() === key)) {
      throw new AppError('SCENE_NAME_CONFLICT', 'A scene with this name already exists.');
    }
    return normalized;
  }

  /** Deletes pixel files no scene refers to. Skipped when any manifest is unreadable: drawings must never be lost. */
  private async removeUnusedLayerFiles(projectPath: string, scenes: readonly SceneInfo[]): Promise<void> {
    try {
      const keep = new Set<string>();
      for (const scene of scenes) {
        const raw = await this.repository.readAnimationManifest(projectPath, scene.id);
        if (raw !== null) {
          layerFilesOf(parseAnimationManifest(raw)).forEach((file) => keep.add(file));
        }
      }
      await this.repository.removeLayerFilesExcept(projectPath, keep);
    } catch {
      // Orphaned files are harmless.
    }
  }
}
