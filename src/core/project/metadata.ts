import { DEFAULT_PROJECT_CANVAS, MAX_PROJECT_NAME_LENGTH, PROJECT_FORMAT_VERSION } from './constants';
import { AppError } from '../errors';
import type { ProjectCanvas, ProjectMetadata } from '@shared/types/project';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Normalizes the canvas metadata while preserving compatibility with older projects. */
export function normalizeProjectCanvas(raw: unknown): ProjectCanvas {
  const fallback: ProjectCanvas = { ...DEFAULT_PROJECT_CANVAS };

  if (raw === undefined) {
    return fallback;
  }

  if (!isRecord(raw)) {
    throw new AppError('INVALID_PROJECT_FILE', 'The project file is not valid.');
  }

  const { width, height, keepAspectRatio, aspectRatio } = raw;
  if (typeof keepAspectRatio !== 'boolean') {
    throw new AppError('INVALID_PROJECT_FILE', 'The project file is not valid.');
  }
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new AppError('INVALID_PROJECT_FILE', 'The project file is not valid.');
  }

  const normalized: ProjectCanvas = {
    width,
    height,
    keepAspectRatio
  };

  if (keepAspectRatio) {
    if (!isRecord(aspectRatio) || !isPositiveInteger(aspectRatio.width) || !isPositiveInteger(aspectRatio.height)) {
      throw new AppError('INVALID_PROJECT_FILE', 'The project file is not valid.');
    }
    return {
      ...normalized,
      aspectRatio: {
        width: aspectRatio.width,
        height: aspectRatio.height
      }
    };
  }

  return normalized;
}

/** Validates the parsed content of `project.json`. Pure: performs no I/O. */
export function parseProjectMetadata(raw: unknown): ProjectMetadata {
  if (!isRecord(raw)) {
    throw new AppError('INVALID_PROJECT_FILE', 'The project file is not valid.');
  }

  const { formatVersion, id, name, createdAt, updatedAt } = raw;

  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion) || formatVersion < 1) {
    throw new AppError('INVALID_PROJECT_FILE', 'The project file is not valid.');
  }
  if (formatVersion > PROJECT_FORMAT_VERSION) {
    throw new AppError(
      'UNSUPPORTED_FORMAT_VERSION',
      'This project was created with a newer version of Animation Studio and cannot be opened.'
    );
  }
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new AppError('INVALID_PROJECT_ID', 'The project file has an invalid project ID.');
  }
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > MAX_PROJECT_NAME_LENGTH * 2) {
    throw new AppError('INVALID_PROJECT_NAME', 'The project file has an invalid project name.');
  }
  if (!isIsoTimestamp(createdAt) || !isIsoTimestamp(updatedAt)) {
    throw new AppError('INVALID_PROJECT_FILE', 'The project file is not valid.');
  }

  return { formatVersion, id, name, createdAt, updatedAt, canvas: normalizeProjectCanvas(raw.canvas) };
}
