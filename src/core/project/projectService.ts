import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DEFAULT_PROJECT_CANVAS, PROJECT_FILE_NAME, PROJECT_FORMAT_VERSION } from './constants';
import {
  ANIMATION_FORMAT_VERSION,
  compressPixels,
  decompressPixels,
  layerFileName,
  parseAnimationDocument,
  parseAnimationManifest,
  type AnimationManifest
} from './animationFormat';
import { normalizeProjectCanvas, parseProjectMetadata } from './metadata';
import { normalizeProjectName, toDirectoryName } from './names';
import { ProjectRepository } from './projectRepository';
import type { OpenProject, ProjectValidationResult } from './types';
import { AppError } from '../errors';
import type { AnimationDocument } from '@shared/types/animation';
import type { ProjectCanvas, ProjectMetadata } from '@shared/types/project';

export interface ProjectServiceOptions {
  repository?: ProjectRepository;
  now?: () => Date;
  generateId?: () => string;
}

/**
 * Project Management API (HU_00001 §19). The only entry point through which
 * the UI, tests, and future AI/MCP integrations read or change projects.
 */
export class ProjectService {
  private readonly repository: ProjectRepository;
  private readonly now: () => Date;
  private readonly generateId: () => string;
  private current: OpenProject | null = null;

  constructor(options: ProjectServiceOptions = {}) {
    this.repository = options.repository ?? new ProjectRepository();
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUUID;
  }

  /** Creates a new project directory and opens it. */
  async createProject(name: string, location: string, canvas: ProjectCanvas = DEFAULT_PROJECT_CANVAS): Promise<OpenProject> {
    const projectName = normalizeProjectName(name);
    const locationPath = this.requireAbsolutePath(location, 'INVALID_LOCATION', 'Select a location for the project.');

    await this.repository.ensureLocation(locationPath);

    const projectPath = path.join(locationPath, toDirectoryName(projectName));
    const state = await this.repository.getDirectoryState(projectPath);
    if (state === 'not-a-directory') {
      throw new AppError('DIRECTORY_NOT_EMPTY', 'A file with this name already exists in the selected location.');
    }
    if (state === 'not-empty') {
      if (await this.repository.fileExists(path.join(projectPath, PROJECT_FILE_NAME))) {
        throw new AppError('PROJECT_ALREADY_EXISTS', 'A project with this name already exists.');
      }
      throw new AppError('DIRECTORY_NOT_EMPTY', 'A folder with this name already exists and is not empty.');
    }

    const timestamp = this.now().toISOString();
    const metadata: ProjectMetadata = {
      formatVersion: PROJECT_FORMAT_VERSION,
      id: this.generateId(),
      name: projectName,
      createdAt: timestamp,
      updatedAt: timestamp,
      canvas: normalizeProjectCanvas(canvas)
    };

    await this.repository.createProject(projectPath, metadata);

    this.current = { path: projectPath, metadata };
    return this.current;
  }

  /** Validates and opens an existing project. Never creates files in the folder. */
  async openProject(projectPath: string): Promise<OpenProject> {
    const resolved = this.requireAbsolutePath(projectPath, 'NOT_A_PROJECT', 'The selected folder is not a valid Animation Studio project.');
    const result = await this.validateProject(resolved);
    if (!result.valid) {
      throw new AppError(result.code, result.message);
    }
    this.current = { path: resolved, metadata: result.metadata };
    return this.current;
  }

  closeProject(): void {
    this.current = null;
  }

  getCurrentProject(): OpenProject | null {
    return this.current;
  }

  /** Checks a directory against the project format without opening it. */
  async validateProject(projectPath: string): Promise<ProjectValidationResult> {
    try {
      const state = await this.repository.getDirectoryState(projectPath);
      if (state === 'missing') {
        throw new AppError('PROJECT_UNAVAILABLE', 'The project could not be found at this location.');
      }
      if (state === 'not-a-directory') {
        throw new AppError('NOT_A_PROJECT', 'The selected folder is not a valid Animation Studio project.');
      }
      const metadata = parseProjectMetadata(await this.repository.readMetadataFile(projectPath));
      const missingDirectories = await this.repository.findMissingDirectories(projectPath);
      if (missingDirectories.length > 0) {
        return {
          valid: false,
          code: 'MISSING_DIRECTORIES',
          message: 'The project structure is incomplete and needs to be repaired.',
          missingDirectories
        };
      }
      return { valid: true, metadata, missingDirectories: [] };
    } catch (error) {
      if (error instanceof AppError) {
        return { valid: false, code: error.code, message: error.message, missingDirectories: [] };
      }
      throw error;
    }
  }

  /**
   * Recreates missing required directories. Only acts on folders with a valid
   * `project.json`, never deletes or overwrites anything. Returns the
   * directories that were created.
   */
  async repairProject(projectPath: string): Promise<string[]> {
    const resolved = this.requireAbsolutePath(projectPath, 'NOT_A_PROJECT', 'The selected folder is not a valid Animation Studio project.');
    const state = await this.repository.getDirectoryState(resolved);
    if (state === 'missing') {
      throw new AppError('PROJECT_UNAVAILABLE', 'The project could not be found at this location.');
    }
    parseProjectMetadata(await this.repository.readMetadataFile(resolved));
    return this.repository.createMissingDirectories(resolved);
  }

  getProjectMetadata(): ProjectMetadata {
    return this.requireCurrent().metadata;
  }

  /**
   * Persists metadata of the open project. `id`, `createdAt` and
   * `formatVersion` are immutable; `updatedAt` is set by the service.
   * Unknown fields already present in `project.json` are preserved.
   */
  async saveProjectMetadata(changes: Pick<ProjectMetadata, 'name'>): Promise<ProjectMetadata> {
    const { path: projectPath, metadata: existing } = this.requireCurrent();
    const name = normalizeProjectName(changes.name);

    const onDisk = await this.repository.readMetadataFile(projectPath);
    const extraFields = typeof onDisk === 'object' && onDisk !== null && !Array.isArray(onDisk) ? onDisk : {};

    const updated: ProjectMetadata = {
      formatVersion: existing.formatVersion,
      id: existing.id,
      name,
      createdAt: existing.createdAt,
      updatedAt: this.now().toISOString(),
      canvas: existing.canvas
    };
    await this.repository.writeMetadataFile(projectPath, { ...extraFields, ...updated });

    this.current = { path: projectPath, metadata: updated };
    return updated;
  }

  /** Changes the project name only; the directory is left untouched. */
  renameProject(name: string): Promise<ProjectMetadata> {
    return this.saveProjectMetadata({ name });
  }

  /**
   * Reads the stored animation (frames, layers and drawings) of the open
   * project. Resolves to `null` when nothing has been saved yet.
   */
  async loadAnimation(): Promise<AnimationDocument | null> {
    const { path: projectPath, metadata } = this.requireCurrent();
    const raw = await this.repository.readAnimationManifest(projectPath);
    if (raw === null) {
      return null;
    }
    const manifest = parseAnimationManifest(raw);
    if (manifest.width !== metadata.canvas.width || manifest.height !== metadata.canvas.height) {
      throw new AppError('INVALID_ANIMATION_DATA', 'The stored drawings do not match the canvas size of this project.');
    }
    const length = manifest.width * manifest.height * 4;
    const cache = new Map<string, Uint8Array>();
    const frames: AnimationDocument['frames'] = [];
    for (const frame of manifest.frames) {
      const layers: AnimationDocument['frames'][number]['layers'] = [];
      for (const layer of frame.layers) {
        let pixels: Uint8Array | null = null;
        if (layer.file !== null) {
          let cached = cache.get(layer.file);
          if (cached === undefined) {
            cached = await decompressPixels(await this.repository.readLayerFile(projectPath, layer.file), length);
            cache.set(layer.file, cached);
          }
          // Identical layers share one file; give each layer its own buffer.
          pixels = new Uint8Array(cached);
        }
        layers.push({ id: layer.id, name: layer.name, visible: layer.visible, pixels });
      }
      frames.push({ id: frame.id, layers });
    }
    return { width: manifest.width, height: manifest.height, frames };
  }

  /**
   * Persists the animation of the open project. Pixel files are written first
   * and the manifest last (atomically), so an interrupted save leaves the
   * previous animation intact.
   */
  async saveAnimation(input: unknown): Promise<void> {
    const { path: projectPath, metadata } = this.requireCurrent();
    const document = parseAnimationDocument(input);
    if (document.width !== metadata.canvas.width || document.height !== metadata.canvas.height) {
      throw new AppError('INVALID_ANIMATION_DATA', 'The drawings do not match the canvas size of this project.');
    }

    const keep = new Set<string>();
    const manifest: AnimationManifest = {
      formatVersion: ANIMATION_FORMAT_VERSION,
      width: document.width,
      height: document.height,
      frames: []
    };
    for (const frame of document.frames) {
      const layers: AnimationManifest['frames'][number]['layers'] = [];
      for (const layer of frame.layers) {
        let file: string | null = null;
        if (layer.pixels !== null && layer.pixels.some((byte) => byte !== 0)) {
          file = layerFileName(layer.pixels);
          if (!keep.has(file)) {
            await this.repository.writeLayerFile(projectPath, file, await compressPixels(layer.pixels));
            keep.add(file);
          }
        }
        layers.push({ id: layer.id, name: layer.name, visible: layer.visible, file });
      }
      manifest.frames.push({ id: frame.id, layers });
    }
    await this.repository.writeAnimationManifest(projectPath, manifest);
    await this.repository.removeLayerFilesExcept(projectPath, keep);
  }

  private requireCurrent(): OpenProject {
    if (this.current === null) {
      throw new AppError('NO_PROJECT_OPEN', 'No project is open.');
    }
    return this.current;
  }

  private requireAbsolutePath(value: unknown, code: 'INVALID_LOCATION' | 'NOT_A_PROJECT', message: string): string {
    if (typeof value !== 'string' || value.trim().length === 0 || !path.isAbsolute(value)) {
      throw new AppError(code, message);
    }
    return path.resolve(value);
  }
}
