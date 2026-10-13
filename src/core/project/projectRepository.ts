import { randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { ANIMATION_LAYERS_DIRECTORY, ANIMATION_MANIFEST_FILE } from './animationFormat';
import {
  CACHE_DIRECTORY,
  PROJECT_FILE_NAME,
  REQUIRED_PROJECT_DIRECTORIES,
  SCENE_REGISTRY_FILE,
  SCENES_DIRECTORY
} from './constants';
import { AppError, isNodeError, isPermissionError } from '../errors';

export type DirectoryState = 'missing' | 'empty' | 'not-empty' | 'not-a-directory';

const damagedAnimation = (): AppError =>
  new AppError('INVALID_ANIMATION_DATA', 'The stored animation is damaged and could not be read.');

/**
 * Filesystem access for projects. This is the only place in the project layer
 * that touches `fs`; everything above it works with parsed data.
 */
export class ProjectRepository {
  async getDirectoryState(directory: string): Promise<DirectoryState> {
    try {
      const stat = await fs.stat(directory);
      if (!stat.isDirectory()) {
        return 'not-a-directory';
      }
      const entries = await fs.readdir(directory);
      return entries.length === 0 ? 'empty' : 'not-empty';
    } catch (error) {
      if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        return 'missing';
      }
      if (isPermissionError(error)) {
        throw new AppError('PERMISSION_DENIED', 'Animation Studio does not have permission to access this folder.', {
          cause: error
        });
      }
      throw new AppError('PROJECT_UNAVAILABLE', 'The folder could not be accessed.', { cause: error });
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      return (await fs.stat(filePath)).isFile();
    } catch {
      return false;
    }
  }

  /** Reads and JSON-parses `project.json`. Returns the raw (unvalidated) value. */
  async readMetadataFile(projectPath: string): Promise<unknown> {
    const file = path.join(projectPath, PROJECT_FILE_NAME);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR')) {
        throw new AppError('NOT_A_PROJECT', 'The selected folder is not a valid Animation Studio project.', {
          cause: error
        });
      }
      if (isPermissionError(error)) {
        throw new AppError('PERMISSION_DENIED', 'Animation Studio does not have permission to read this project.', {
          cause: error
        });
      }
      throw new AppError('INVALID_PROJECT_FILE', 'The project file could not be read.', { cause: error });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new AppError('INVALID_PROJECT_FILE', 'The project file is damaged and could not be read.', {
        cause: error
      });
    }
  }

  /**
   * Writes `project.json` atomically: the content is written and flushed to a
   * temporary file which then replaces the real file with a rename.
   */
  async writeMetadataFile(projectPath: string, content: object): Promise<void> {
    await this.writeFileAtomic(path.join(projectPath, PROJECT_FILE_NAME), `${JSON.stringify(content, null, 2)}\n`);
  }

  /** Reads the scene registry. `null` when the project has none yet. */
  readSceneRegistry(projectPath: string): Promise<unknown | null> {
    return this.readOptionalJson(this.sceneRegistryFile(projectPath), () =>
      new AppError('INVALID_SCENE_DATA', 'The scene list is damaged and could not be read.')
    );
  }

  async writeSceneRegistry(projectPath: string, content: object): Promise<void> {
    await this.writeJson(this.sceneRegistryFile(projectPath), content);
  }

  /** Reads the animation manifest of a scene. `null` when the scene has no stored animation yet. */
  readAnimationManifest(projectPath: string, sceneId: string): Promise<unknown | null> {
    return this.readOptionalJson(this.sceneManifestFile(projectPath, sceneId), damagedAnimation);
  }

  async writeAnimationManifest(projectPath: string, sceneId: string, content: object): Promise<void> {
    await this.writeJson(this.sceneManifestFile(projectPath, sceneId), content);
  }

  /** Removes the files of a scene, keeping the shared layer files. Failures are ignored: orphans are harmless. */
  async removeSceneFiles(projectPath: string, sceneId: string): Promise<void> {
    await fs
      .rm(path.join(projectPath, SCENES_DIRECTORY, sceneId), { recursive: true, force: true })
      .catch(() => undefined);
  }

  /** The single animation older projects kept in `drawings/`, before scenes existed. */
  readLegacyAnimationManifest(projectPath: string): Promise<unknown | null> {
    return this.readOptionalJson(this.legacyManifestFile(projectPath), damagedAnimation);
  }

  async removeLegacyAnimationManifest(projectPath: string): Promise<void> {
    await fs.rm(this.legacyManifestFile(projectPath), { force: true }).catch(() => undefined);
  }

  async readLayerFile(projectPath: string, fileName: string): Promise<Buffer> {
    try {
      return await fs.readFile(path.join(projectPath, ...this.drawingsDirectory(), ANIMATION_LAYERS_DIRECTORY, fileName));
    } catch (error) {
      if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        throw new AppError('INVALID_ANIMATION_DATA', 'A stored drawing file is missing.', { cause: error });
      }
      throw this.toReadError(error);
    }
  }

  /** Stores a layer file unless a file with that (content-derived) name already exists. */
  async writeLayerFile(projectPath: string, fileName: string, data: Uint8Array): Promise<void> {
    const directory = path.join(projectPath, ...this.drawingsDirectory(), ANIMATION_LAYERS_DIRECTORY);
    await this.ensureDirectory(directory);
    const target = path.join(directory, fileName);
    if (await this.fileExists(target)) {
      return;
    }
    await this.writeFileAtomic(target, data);
  }

  /** Deletes layer files that are not in `keep`. Failures are ignored: orphans are harmless. */
  async removeLayerFilesExcept(projectPath: string, keep: ReadonlySet<string>): Promise<void> {
    const directory = path.join(projectPath, ...this.drawingsDirectory(), ANIMATION_LAYERS_DIRECTORY);
    try {
      for (const entry of await fs.readdir(directory)) {
        if (entry.endsWith('.rgba.z') && !keep.has(entry)) {
          await fs.rm(path.join(directory, entry), { force: true });
        }
      }
    } catch {
      // Best effort cleanup.
    }
  }

  /**
   * Writes a file atomically: the content is written and flushed to a
   * temporary file which then replaces the real file with a rename.
   */
  private async writeFileAtomic(target: string, content: string | Uint8Array): Promise<void> {
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temp, 'w');
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temp, target);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      if (isPermissionError(error)) {
        throw new AppError('PERMISSION_DENIED', 'Animation Studio does not have permission to save this project.', {
          cause: error
        });
      }
      throw new AppError('WRITE_FAILED', 'The project could not be saved.', { cause: error });
    }
  }

  private async ensureDirectory(directory: string): Promise<void> {
    try {
      await fs.mkdir(directory, { recursive: true });
    } catch (error) {
      if (isPermissionError(error)) {
        throw new AppError('PERMISSION_DENIED', 'Animation Studio does not have permission to save this project.', {
          cause: error
        });
      }
      throw new AppError('WRITE_FAILED', 'The project could not be saved.', { cause: error });
    }
  }

  private async readOptionalJson(file: string, damaged: () => AppError): Promise<unknown | null> {
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        return null;
      }
      throw this.toReadError(error);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw damaged();
    }
  }

  private async writeJson(file: string, content: object): Promise<void> {
    await this.ensureDirectory(path.dirname(file));
    await this.writeFileAtomic(file, `${JSON.stringify(content, null, 2)}\n`);
  }

  private sceneRegistryFile(projectPath: string): string {
    return path.join(projectPath, SCENES_DIRECTORY, SCENE_REGISTRY_FILE);
  }

  /** `sceneId` must be a validated identifier: it becomes a path segment. */
  private sceneManifestFile(projectPath: string, sceneId: string): string {
    return path.join(projectPath, SCENES_DIRECTORY, sceneId, ANIMATION_MANIFEST_FILE);
  }

  private legacyManifestFile(projectPath: string): string {
    return path.join(projectPath, ...this.drawingsDirectory(), ANIMATION_MANIFEST_FILE);
  }

  private drawingsDirectory(): readonly string[] {
    return ['drawings'];
  }

  private toReadError(error: unknown): AppError {
    if (isPermissionError(error)) {
      return new AppError('PERMISSION_DENIED', 'Animation Studio does not have permission to read this project.', {
        cause: error
      });
    }
    return new AppError('PROJECT_UNAVAILABLE', 'The project files could not be read.', { cause: error });
  }

  /** Returns the required directories (relative paths) that do not exist. */
  async findMissingDirectories(projectPath: string): Promise<string[]> {
    const missing: string[] = [];
    for (const segments of REQUIRED_PROJECT_DIRECTORIES) {
      const state = await this.getDirectoryState(path.join(projectPath, ...segments));
      if (state === 'missing' || state === 'not-a-directory') {
        missing.push(path.join(...segments));
      }
    }
    return missing;
  }

  /** Creates missing required directories. Never touches existing content. */
  async createMissingDirectories(projectPath: string): Promise<string[]> {
    const missing = await this.findMissingDirectories(projectPath);
    try {
      for (const relative of missing) {
        await fs.mkdir(path.join(projectPath, relative), { recursive: true });
      }
    } catch (error) {
      throw this.toCreateError(error);
    }
    return missing;
  }

  /**
   * Creates the project directory with its full structure (including
   * `.cache/`) and writes `project.json` last, so an interrupted creation never
   * leaves something that looks like a valid project. On failure, removes only
   * what this call created.
   */
  async createProject(projectPath: string, metadata: object): Promise<void> {
    const existedBefore = (await this.getDirectoryState(projectPath)) !== 'missing';
    const directories = [...REQUIRED_PROJECT_DIRECTORIES, CACHE_DIRECTORY];
    const topLevel = new Set(directories.map((segments) => segments[0] as string));
    try {
      await fs.mkdir(projectPath, { recursive: true });
      for (const segments of directories) {
        await fs.mkdir(path.join(projectPath, ...segments), { recursive: true });
      }
      await this.writeMetadataFile(projectPath, metadata);
    } catch (error) {
      await this.rollbackCreation(projectPath, existedBefore, topLevel);
      throw error instanceof AppError ? error : this.toCreateError(error);
    }
  }

  private async rollbackCreation(projectPath: string, existedBefore: boolean, topLevel: Iterable<string>): Promise<void> {
    try {
      if (!existedBefore) {
        await fs.rm(projectPath, { recursive: true, force: true });
        return;
      }
      for (const name of [...topLevel, PROJECT_FILE_NAME]) {
        await fs.rm(path.join(projectPath, name), { recursive: true, force: true });
      }
    } catch {
      // Best effort; the original error is what matters to the caller.
    }
  }

  /** Ensures a location directory exists, creating it if needed. */
  async ensureLocation(location: string): Promise<void> {
    const state = await this.getDirectoryState(location);
    if (state === 'not-a-directory') {
      throw new AppError('INVALID_LOCATION', 'The selected location is not a folder.');
    }
    if (state === 'missing') {
      try {
        await fs.mkdir(location, { recursive: true });
      } catch (error) {
        throw this.toCreateError(error);
      }
    }
    try {
      await fs.access(location, fsConstants.W_OK);
    } catch (error) {
      throw new AppError('LOCATION_NOT_WRITABLE', 'The selected location is not writable.', { cause: error });
    }
  }

  private toCreateError(error: unknown): AppError {
    if (isPermissionError(error)) {
      return new AppError('LOCATION_NOT_WRITABLE', 'The selected location is not writable.', { cause: error });
    }
    return new AppError('WRITE_FAILED', 'Unable to create the project.', { cause: error });
  }
}
