import type { BrushCanvas, BrushSample } from '../brushes/brush';
import { findBrush, sanitizeBrushSettings } from '../brushes/registry';
import { clearRegion, compositeRegion, createDrawing, markDirty, unionRect } from '../drawing/raster';
import type { DrawingData, Point, Rect } from '../model';
import { parseHexColor } from '../validation';
import type { BezierCurve } from './curve';
import { flattenAnchors } from './geometry';

/** Paints `curve` on `canvas` with its own brush, exactly as a brush stroke along the flattened path. */
export function paintCurveStroke(curve: BezierCurve, canvas: BrushCanvas): void {
  const { style } = curve;
  const brush = findBrush(style.brush);
  const opacity = style.opacity / 100;
  const stroke = brush.startStroke(sanitizeBrushSettings(brush, style.settings), {
    canvas,
    color: parseHexColor(style.color) ?? [0, 0, 0],
    seed: style.seed,
    variableOpacity: opacity < 1
  });
  const sample = (point: Point): BrushSample => ({ x: point.x, y: point.y, size: style.size, opacity });
  const points = flattenAnchors(curve.anchors);
  stroke.begin(sample(points[0] as Point));
  points.slice(1).forEach((point) => stroke.extend(sample(point)));
  stroke.end();
}

/** Draws one curve onto `scratch` (which must be blank). Returns the rectangle that was painted, or `null`. */
function paintCurve(curve: BezierCurve, scratch: DrawingData): Rect | null {
  const painted: { rect: Rect | null } = { rect: null };
  paintCurveStroke(curve, {
    apply: (operation) => {
      const rect = operation(scratch, null);
      if (rect !== null) {
        painted.rect = painted.rect === null ? rect : unionRect(painted.rect, rect);
      }
    }
  });
  return painted.rect;
}

/**
 * Renders curves, bottom first, onto a blank `target`. Each curve is painted on its own
 * so that opacity and grain act on the curve alone before it is composited with the others.
 */
function renderCurves(curves: readonly BezierCurve[], target: DrawingData): void {
  target.data?.fill(0);
  const scratch = createDrawing(target.width, target.height);
  for (const curve of curves) {
    const rect = paintCurve(curve, scratch);
    if (rect !== null) {
      compositeRegion(target, scratch, rect);
      clearRegion(scratch, rect);
    }
  }
  markDirty(target, { x: 0, y: 0, width: target.width, height: target.height });
}

/**
 * Raster of the curves of one layer. It is derived data: it is rebuilt from the curves
 * whenever the list changed, so it never has to be saved, copied or undone.
 */
export class CurveCache {
  private readonly drawing: DrawingData;
  private source: readonly BezierCurve[] = [];

  constructor(width: number, height: number) {
    this.drawing = createDrawing(width, height);
  }

  /** Pixels of `curves`, rendered only when the list differs from the previous call; `null` when there are none. */
  rasterize(curves: readonly BezierCurve[]): DrawingData | null {
    if (curves.length === 0) {
      return null;
    }
    if (curves !== this.source) {
      renderCurves(curves, this.drawing);
      this.source = curves;
    }
    return this.drawing;
  }
}
