import { AppError } from '../errors';
import {
  MAX_EXPORT_DIMENSION,
  MAX_EXPORT_FPS,
  MAX_EXPORT_PIXELS,
  type AnimationExport,
  type DestinationQuery,
  type ExportBackground,
  type ExportRequest,
  type ExportResolution,
  type FrameRange,
  type SceneScope
} from '@shared/types/export';

const KINDS = ['current-frame', 'frames', 'frames-zip', 'animation'] as const;
const SCOPES = ['active', 'all'] as const;
const FORMATS = ['mp4', 'gif'] as const;
const QUALITIES = ['low', 'balanced', 'high'] as const;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_SUGGESTED_NAME_LENGTH = 200;

function invalid(message = 'The export settings are not valid.'): AppError {
  return new AppError('INVALID_EXPORT', message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid();
  }
  return value as Record<string, unknown>;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw invalid();
  }
  return value as T;
}

function parseInteger(value: unknown, min: number, max: number, message?: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(message);
  }
  return value;
}

function parseRange(value: unknown): FrameRange | null {
  if (value === null) {
    return null;
  }
  const { start, end } = asRecord(value);
  const range = {
    start: parseInteger(start, 1, Number.MAX_SAFE_INTEGER, 'The first frame must be a positive whole number.'),
    end: parseInteger(end, 1, Number.MAX_SAFE_INTEGER, 'The last frame must be a positive whole number.')
  };
  if (range.start > range.end) {
    throw invalid('The first frame cannot come after the last frame.');
  }
  return range;
}

function parseResolution(value: unknown): ExportResolution {
  const record = asRecord(value);
  if (oneOf(record.mode, ['original', 'custom']) === 'original') {
    return { mode: 'original' };
  }
  const message = `The size must be between 1 and ${MAX_EXPORT_DIMENSION} pixels on each side.`;
  const width = parseInteger(record.width, 1, MAX_EXPORT_DIMENSION, message);
  const height = parseInteger(record.height, 1, MAX_EXPORT_DIMENSION, message);
  if (width * height > MAX_EXPORT_PIXELS) {
    throw invalid('The output size is too large. Choose a smaller resolution.');
  }
  return { mode: 'custom', width, height };
}

function parseBackground(value: unknown): ExportBackground {
  const record = asRecord(value);
  if (oneOf(record.type, ['transparent', 'color']) === 'transparent') {
    return { type: 'transparent' };
  }
  if (typeof record.color !== 'string' || !COLOR_PATTERN.test(record.color)) {
    throw invalid('The background color is not valid.');
  }
  return { type: 'color', color: record.color.toLowerCase() };
}

function parseFlag(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw invalid();
  }
  return value;
}

function parseSelection(record: Record<string, unknown>): { scope: SceneScope; range: FrameRange | null } {
  const scope = oneOf(record.scope, SCOPES);
  const range = parseRange(record.range);
  if (scope === 'all' && range !== null) {
    throw invalid('A frame range can only be used when exporting the active scene.');
  }
  return { scope, range };
}

function parseAnimation(record: Record<string, unknown>, common: { destinationId: string; overwrite: boolean }): AnimationExport {
  const format = oneOf(record.format, FORMATS);
  const background = parseBackground(record.background);
  if (format === 'mp4' && background.type === 'transparent') {
    throw invalid('MP4 does not support transparency. Choose a background color.');
  }
  return {
    ...common,
    kind: 'animation',
    format,
    ...parseSelection(record),
    resolution: parseResolution(record.resolution),
    fps: parseInteger(record.fps, 1, MAX_EXPORT_FPS, `The frame rate must be a whole number from 1 to ${MAX_EXPORT_FPS}.`),
    background,
    quality: oneOf(record.quality, QUALITIES),
    loop: parseFlag(record.loop)
  };
}

/** Validates an export request received over IPC. Nothing in it is trusted. */
export function parseExportRequest(input: unknown): ExportRequest {
  const record = asRecord(input);
  const destinationId = record.destinationId;
  if (typeof destinationId !== 'string' || !ID_PATTERN.test(destinationId)) {
    throw invalid();
  }
  const common = { destinationId, overwrite: parseFlag(record.overwrite) };
  const kind = oneOf(record.kind, KINDS);
  if (kind === 'current-frame') {
    if (typeof record.frameId !== 'string' || !ID_PATTERN.test(record.frameId)) {
      throw invalid();
    }
    return { ...common, kind, frameId: record.frameId };
  }
  if (kind === 'animation') {
    return parseAnimation(record, common);
  }
  return {
    ...common,
    kind,
    ...parseSelection(record),
    resolution: parseResolution(record.resolution)
  };
}

export function parseDestinationQuery(input: unknown): DestinationQuery {
  const record = asRecord(input);
  if (typeof record.suggestedName !== 'string' || record.suggestedName.length > MAX_SUGGESTED_NAME_LENGTH) {
    throw invalid();
  }
  return {
    kind: oneOf(record.kind, KINDS),
    scope: oneOf(record.scope, SCOPES),
    format: oneOf(record.format, FORMATS),
    suggestedName: record.suggestedName
  };
}
