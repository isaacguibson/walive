import { promises as fs, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { AppError, isNodeError, isPermissionError } from '../errors';
import type { AssetImportResult, ProjectAsset, ProjectAssetType, SkippedAsset } from '@shared/types/assets';

/** Directory (below `assets/`) used for each asset type. `other` is never imported, only listed. */
const TYPE_DIRECTORIES: Record<Exclude<ProjectAssetType, 'other'>, string> = {
  image: 'images',
  audio: 'audio',
  video: 'video',
  font: 'fonts'
};

const EXTENSIONS: Record<Exclude<ProjectAssetType, 'other'>, readonly string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi'],
  font: ['ttf', 'otf', 'woff', 'woff2']
};

const MAX_ASSET_NAME_LENGTH = 100;
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export interface AssetServiceOptions {
  /** Absolute path of the open project, or `null` when none is open. */
  getProjectPath(): string | null;
}

/** Splits `name.ext` into its base name and lower-case extension (without the dot). */
function splitName(fileName: string): { base: string; extension: string } {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) {
    return { base: fileName, extension: '' };
  }
  return { base: fileName.slice(0, dot), extension: fileName.slice(dot + 1).toLowerCase() };
}

export function classifyExtension(extension: string): ProjectAssetType {
  const lower = extension.toLowerCase();
  for (const type of Object.keys(EXTENSIONS) as (keyof typeof EXTENSIONS)[]) {
    if (EXTENSIONS[type].includes(lower)) {
      return type;
    }
  }
  return 'other';
}

/**
 * Project-wide asset management (HU_00005 §7). Assets are plain files below
 * `<project>/assets/<type>/`; the project-relative path is the asset id, and
 * ids are only ever resolved by looking them up in the current listing, so a
 * caller can never reach a file outside the asset directories.
 */
export class AssetService {
  constructor(private readonly options: AssetServiceOptions) {}

  async readAssetImage(assetId: string): Promise<string> {
    const projectPath = this.requireProject();
    const asset = await this.requireAsset(assetId);
    if (asset.type !== 'image') {
      throw new AppError('UNSUPPORTED_ASSET_TYPE', 'Only image assets can be inserted into the canvas.');
    }
    const buffer = await fs.readFile(this.absolutePath(projectPath, asset.relativePath));
    const mimeType = this.mimeTypeForExtension(asset.extension);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  async listAssets(): Promise<ProjectAsset[]> {
    const projectPath = this.requireProject();
    const assets: ProjectAsset[] = [];
    for (const directory of Object.values(TYPE_DIRECTORIES)) {
      let entries;
      try {
        entries = await fs.readdir(path.join(projectPath, 'assets', directory), { withFileTypes: true });
      } catch (error) {
        if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
          continue;
        }
        throw this.toFailure(error, 'The project assets could not be read.');
      }
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.startsWith('.') || entry.name.endsWith('.tmp')) {
          continue;
        }
        assets.push(this.toAsset(directory, entry.name));
      }
    }
    return assets.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /**
   * Copies the given files into the project. Existing assets are never
   * overwritten: a numeric suffix is added to the new file name instead.
   * Unsupported files are reported in `skipped` rather than failing the import.
   */
  async importAssets(sourcePaths: readonly string[]): Promise<AssetImportResult> {
    const projectPath = this.requireProject();
    const imported: ProjectAsset[] = [];
    const skipped: SkippedAsset[] = [];

    for (const source of sourcePaths) {
      if (typeof source !== 'string' || !path.isAbsolute(source)) {
        throw new AppError('INVALID_REQUEST', 'The request could not be processed.');
      }
      const fileName = path.basename(source);
      const { extension } = splitName(fileName);
      const type = classifyExtension(extension);
      if (type === 'other') {
        skipped.push({ name: fileName, reason: 'This file type is not supported.' });
        continue;
      }
      try {
        if (!(await fs.stat(source)).isFile()) {
          skipped.push({ name: fileName, reason: 'Only files can be imported.' });
          continue;
        }
      } catch {
        skipped.push({ name: fileName, reason: 'The file could not be read.' });
        continue;
      }

      const directory = TYPE_DIRECTORIES[type];
      const targetDirectory = path.join(projectPath, 'assets', directory);
      try {
        await fs.mkdir(targetDirectory, { recursive: true });
        const copiedName = await this.copyWithoutOverwriting(source, targetDirectory, fileName);
        imported.push(this.toAsset(directory, copiedName));
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        skipped.push({ name: fileName, reason: 'The file could not be copied into the project.' });
      }
    }
    return { imported, skipped };
  }

  /** Renames an asset in place. `newName` excludes the extension, which is preserved. */
  async renameAsset(assetId: string, newName: string): Promise<ProjectAsset> {
    const projectPath = this.requireProject();
    const asset = await this.requireAsset(assetId);
    const base = this.validateBaseName(newName, asset.extension);
    const targetName = asset.extension === '' ? base : `${base}.${asset.extension}`;
    const directory = path.posix.dirname(asset.relativePath);
    const siblings = await this.listAssets();
    const conflict = siblings.some(
      (other) =>
        other.id !== asset.id &&
        path.posix.dirname(other.relativePath) === directory &&
        other.name.toLowerCase() === targetName.toLowerCase()
    );
    if (conflict) {
      throw new AppError('ASSET_NAME_CONFLICT', 'An asset with this name already exists.');
    }
    if (targetName === asset.name) {
      return asset;
    }
    try {
      await fs.rename(
        this.absolutePath(projectPath, asset.relativePath),
        this.absolutePath(projectPath, `${directory}/${targetName}`)
      );
    } catch (error) {
      throw this.toFailure(error, 'The asset could not be renamed.');
    }
    return this.toAsset(path.posix.basename(directory), targetName);
  }

  async deleteAsset(assetId: string): Promise<void> {
    const projectPath = this.requireProject();
    const asset = await this.requireAsset(assetId);
    try {
      await fs.rm(this.absolutePath(projectPath, asset.relativePath), { force: false });
    } catch (error) {
      throw this.toFailure(error, 'The asset could not be deleted.');
    }
  }

  private async copyWithoutOverwriting(source: string, directory: string, fileName: string): Promise<string> {
    const { base, extension } = splitName(fileName);
    const suffix = fileName.slice(base.length);
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const candidate = attempt === 0 ? fileName : `${base} (${attempt})${suffix}`;
      try {
        await fs.copyFile(source, path.join(directory, candidate), fsConstants.COPYFILE_EXCL);
        return candidate;
      } catch (error) {
        if (isNodeError(error) && error.code === 'EEXIST') {
          continue;
        }
        throw this.toFailure(error, 'The file could not be copied into the project.');
      }
    }
    throw new AppError('ASSET_OPERATION_FAILED', `Could not find a free name for "${base}.${extension}".`);
  }

  private validateBaseName(value: unknown, extension: string): string {
    if (typeof value !== 'string') {
      throw new AppError('INVALID_ASSET_NAME', 'Enter a name for the asset.');
    }
    let name = value.trim();
    if (extension !== '' && name.toLowerCase().endsWith(`.${extension}`)) {
      name = name.slice(0, -(extension.length + 1)).trim();
    }
    if (name.length === 0) {
      throw new AppError('INVALID_ASSET_NAME', 'Enter a name for the asset.');
    }
    if (name.length > MAX_ASSET_NAME_LENGTH) {
      throw new AppError('INVALID_ASSET_NAME', `The asset name must be at most ${MAX_ASSET_NAME_LENGTH} characters.`);
    }
    if (
      UNSAFE_NAME_CHARS.test(name) ||
      name.startsWith('.') ||
      name.endsWith('.') ||
      WINDOWS_RESERVED.test(name)
    ) {
      throw new AppError('INVALID_ASSET_NAME', 'The asset name contains invalid characters.');
    }
    return name;
  }

  private async requireAsset(assetId: unknown): Promise<ProjectAsset> {
    if (typeof assetId !== 'string') {
      throw new AppError('INVALID_REQUEST', 'The request could not be processed.');
    }
    const asset = (await this.listAssets()).find((candidate) => candidate.id === assetId);
    if (asset === undefined) {
      throw new AppError('ASSET_NOT_FOUND', 'The asset could not be found. It may have been moved or deleted.');
    }
    return asset;
  }

  private toAsset(directory: string, fileName: string): ProjectAsset {
    const relativePath = `assets/${directory}/${fileName}`;
    const { extension } = splitName(fileName);
    return { id: relativePath, name: fileName, type: classifyExtension(extension), relativePath, extension };
  }

  private mimeTypeForExtension(extension: string): string {
    switch (extension.toLowerCase()) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      case 'bmp':
        return 'image/bmp';
      case 'svg':
        return 'image/svg+xml';
      default:
        return 'image/png';
    }
  }

  private absolutePath(projectPath: string, relativePath: string): string {
    return path.join(projectPath, ...relativePath.split('/'));
  }

  private requireProject(): string {
    const projectPath = this.options.getProjectPath();
    if (projectPath === null) {
      throw new AppError('NO_PROJECT_OPEN', 'No project is open.');
    }
    return projectPath;
  }

  private toFailure(error: unknown, message: string): AppError {
    if (isPermissionError(error)) {
      return new AppError('PERMISSION_DENIED', 'Animation Studio does not have permission to change this project.', {
        cause: error
      });
    }
    return new AppError('ASSET_OPERATION_FAILED', message, { cause: error });
  }
}
