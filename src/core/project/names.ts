import { MAX_PROJECT_NAME_LENGTH } from './constants';
import { AppError } from '../errors';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const UNSAFE_DIRECTORY_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Validates and normalizes (trims) a human-readable project name. */
export function normalizeProjectName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new AppError('INVALID_NAME', 'Enter a project name.');
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new AppError('INVALID_NAME', 'Enter a project name.');
  }
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) {
    throw new AppError('INVALID_NAME', `The project name must be at most ${MAX_PROJECT_NAME_LENGTH} characters.`);
  }
  if (CONTROL_CHARS.test(trimmed)) {
    throw new AppError('INVALID_NAME', 'The project name contains invalid characters.');
  }
  return trimmed;
}

/**
 * Derives a filesystem-safe directory name from a project name. The project
 * name and the directory name are independent concepts (HU_00001 §7).
 */
export function toDirectoryName(projectName: string): string {
  let result = projectName.replace(UNSAFE_DIRECTORY_CHARS, '-').trim();
  result = result.replace(/[. ]+$/, '');
  if (result.length === 0 || /^\.+$/.test(result)) {
    result = 'Untitled Project';
  }
  if (WINDOWS_RESERVED.test(result)) {
    result = `${result}-project`;
  }
  return result;
}
