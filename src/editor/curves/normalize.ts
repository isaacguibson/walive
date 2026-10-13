import { findBrush, sanitizeBrushSettings } from '../brushes/registry';
import { DEFAULT_COLOR, MAX_TOOL_SIZE, MIN_TOOL_SIZE } from '../constants';
import { parseHexColor } from '../validation';
import type { BezierCurve, CurveStyle } from './curve';
import { isDrawableCurve } from './editing';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A style the renderer can use: unknown brushes fall back to the Basic Brush and every value is brought into range. */
export function normalizeStyle(style: CurveStyle): CurveStyle {
  const brush = findBrush(style.brush);
  return {
    brush: brush.id,
    settings: sanitizeBrushSettings(brush, style.settings),
    color: parseHexColor(style.color) === null ? DEFAULT_COLOR : style.color.toLowerCase(),
    size: clamp(Math.round(style.size), MIN_TOOL_SIZE, MAX_TOOL_SIZE),
    opacity: clamp(Math.round(style.opacity), 0, 100),
    seed: Math.trunc(style.seed) >>> 0
  };
}

/** Curve safe to render and edit, or `null` when stored data describes nothing drawable. */
export function normalizeCurve(curve: BezierCurve): BezierCurve | null {
  const normalized = { ...curve, style: normalizeStyle(curve.style) };
  return isDrawableCurve(normalized) ? normalized : null;
}
