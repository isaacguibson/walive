import { AppError } from '../errors';
import {
  CURVE_LIMITS,
  type AnchorType,
  type BezierCurveData,
  type CurveAnchorData,
  type CurvePoint,
  type CurveStyleData
} from '@shared/types/curves';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const ANCHOR_TYPES: readonly AnchorType[] = ['corner', 'smooth'];
const MAX_BRUSH_ID_LENGTH = 100;
const MAX_STYLE_SETTINGS = 50;

function invalid(): AppError {
  return new AppError('INVALID_ANIMATION_DATA', 'The curve data is not valid.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNumber(value: unknown, limit = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw invalid();
  }
  return value;
}

function parsePoint(value: unknown): CurvePoint {
  if (!isRecord(value)) {
    throw invalid();
  }
  return { x: parseNumber(value.x, CURVE_LIMITS.maxCoordinate), y: parseNumber(value.y, CURVE_LIMITS.maxCoordinate) };
}

function parseAnchor(value: unknown): CurveAnchorData {
  if (!isRecord(value) || !ANCHOR_TYPES.includes(value.type as AnchorType)) {
    throw invalid();
  }
  return {
    ...parsePoint(value),
    type: value.type as AnchorType,
    handleIn: parsePoint(value.handleIn),
    handleOut: parsePoint(value.handleOut)
  };
}

function parseStyle(value: unknown): CurveStyleData {
  if (
    !isRecord(value) ||
    typeof value.brush !== 'string' ||
    value.brush.length < 1 ||
    value.brush.length > MAX_BRUSH_ID_LENGTH ||
    typeof value.color !== 'string' ||
    !COLOR_PATTERN.test(value.color) ||
    !isRecord(value.settings) ||
    Object.keys(value.settings).length > MAX_STYLE_SETTINGS
  ) {
    throw invalid();
  }
  const settings: Record<string, number> = {};
  for (const [key, setting] of Object.entries(value.settings)) {
    settings[key] = parseNumber(setting);
  }
  return {
    brush: value.brush,
    settings,
    color: value.color,
    size: parseNumber(value.size),
    opacity: parseNumber(value.opacity),
    seed: parseNumber(value.seed)
  };
}

/**
 * Validates the curves of one layer, which come from outside the core (IPC or disk).
 * Structure and ranges are checked here; brush ids and settings are interpreted by the editor.
 */
export function parseCurves(input: unknown): BezierCurveData[] {
  if (!Array.isArray(input) || input.length > CURVE_LIMITS.maxCurvesPerLayer) {
    throw invalid();
  }
  const ids = new Set<string>();
  return input.map((raw): BezierCurveData => {
    if (
      !isRecord(raw) ||
      typeof raw.id !== 'string' ||
      !ID_PATTERN.test(raw.id) ||
      ids.has(raw.id) ||
      !Array.isArray(raw.anchors) ||
      raw.anchors.length < 2 ||
      raw.anchors.length > CURVE_LIMITS.maxAnchorsPerCurve
    ) {
      throw invalid();
    }
    ids.add(raw.id);
    return { id: raw.id, anchors: raw.anchors.map(parseAnchor), style: parseStyle(raw.style) };
  });
}
