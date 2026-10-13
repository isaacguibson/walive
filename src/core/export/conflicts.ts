import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { AppError, isNodeError } from '../errors';

const MAX_LISTED_CONFLICTS = 3;

export async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return false;
    }
    throw error;
  }
}

/**
 * Checks, before any work is done, that the destination exists and that none of the
 * files about to be written would replace something unless replacing was approved.
 */
export async function checkDestination(root: string, relativePaths: readonly string[], overwrite: boolean): Promise<void> {
  try {
    const entry = await lstat(root);
    if (!entry.isDirectory()) {
      throw new AppError('INVALID_LOCATION', 'The destination is not a folder.');
    }
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new AppError('INVALID_LOCATION', 'The destination folder does not exist. Choose another location.', { cause: error });
    }
    throw error;
  }
  const existing: string[] = [];
  for (const relativePath of relativePaths) {
    const target = path.join(root, relativePath);
    if (!(await pathExists(target))) {
      continue;
    }
    if ((await lstat(target)).isDirectory()) {
      throw new AppError('INVALID_EXPORT', `"${relativePath}" is a folder and cannot be replaced. Choose another name or location.`);
    }
    existing.push(relativePath);
  }
  if (existing.length > 0 && !overwrite) {
    const listed = existing.slice(0, MAX_LISTED_CONFLICTS).join(', ');
    const more = existing.length > MAX_LISTED_CONFLICTS ? ` and ${existing.length - MAX_LISTED_CONFLICTS} more` : '';
    throw new AppError('EXPORT_CONFLICT', `These files already exist: ${listed}${more}. Replace them or choose another destination.`);
  }
}
