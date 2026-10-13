import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError, isPermissionError } from '../errors';
import { pathExists } from './conflicts';

const PREFIX = '.walive-export-';

/**
 * Temporary directory next to the final destination (so files can be moved into place
 * without copying). Output is only moved to the destination once the whole export succeeded.
 */
export class StagingArea {
  private constructor(
    readonly directory: string,
    private readonly root: string
  ) {}

  static async create(root: string): Promise<StagingArea> {
    try {
      return new StagingArea(await mkdtemp(path.join(root, PREFIX)), root);
    } catch (error) {
      if (isPermissionError(error)) {
        throw new AppError('LOCATION_NOT_WRITABLE', 'The destination folder is not writable. Choose another folder.', { cause: error });
      }
      throw error;
    }
  }

  pathOf(relativePath: string): string {
    return path.join(this.directory, relativePath);
  }

  /** Moves the staged files, given relative to the staging directory, to the same paths below the destination. */
  async commit(relativePaths: readonly string[], overwrite: boolean): Promise<void> {
    let moved = 0;
    try {
      for (const relativePath of relativePaths) {
        const target = path.join(this.root, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        if (overwrite) {
          await rm(target, { force: true });
        } else if (await pathExists(target)) {
          throw new AppError('EXPORT_CONFLICT', 'A file with the same name was created in the meantime.');
        }
        await rename(this.pathOf(relativePath), target);
        moved += 1;
      }
    } catch (error) {
      if (moved === 0) {
        throw error;
      }
      throw new AppError(
        'EXPORT_FAILED',
        `The export was interrupted while saving the files: ${moved} of ${relativePaths.length} were written to the destination.`,
        { cause: error }
      );
    }
  }

  /** Removes the staging directory. Resolves to a warning when that was not possible. */
  async dispose(): Promise<string | null> {
    try {
      await rm(this.directory, { recursive: true, force: true });
      return null;
    } catch {
      return `Temporary files could not be removed. You can delete the folder "${this.directory}" manually.`;
    }
  }
}
