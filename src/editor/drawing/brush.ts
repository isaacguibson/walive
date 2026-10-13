import type { DrawingData, Point, Rect, Rgb } from '../model';
import { clipRect, ensureData } from './raster';

export type StrokeMode = { readonly kind: 'paint'; readonly color: Rgb } | { readonly kind: 'erase' };

/**
 * Modulates the coverage of a pixel (canvas coordinates). `edge` is the distance to the
 * segment's centerline relative to its reach: 0 on the centerline, 1 on the outer edge.
 */
export type Grain = (x: number, y: number, coverage: number, edge: number) => number;

/**
 * Styling of a `paint` segment: an opacity ramp from `start` to `end` (0 to 1) and an
 * optional grain. Overlapping segments of one stroke never stack: each pixel keeps the
 * strongest alpha the stroke gave it, composited over the pixels as they were before
 * the stroke.
 */
export interface SegmentStyle {
  readonly start: number;
  readonly end: number;
  readonly grain?: Grain | undefined;
  /** Strongest alpha (0-255) painted so far on each pixel of the stroke. */
  readonly peak: Uint8Array;
  /** Pixels of the drawing before the stroke began (`null` when it was blank). */
  readonly original: Uint8ClampedArray | null;
}

/**
 * Draws a round-capped line segment of the given diameter (`size`, in pixels).
 * Pixels on the edge are anti-aliased with one pixel of falloff.
 *
 * - `paint` composites the color over the existing pixels.
 * - `erase` removes opacity from the existing pixels.
 *
 * Returns the (clipped) bounding box that may have changed, or `null` when
 * nothing could change. Only the given drawing is touched.
 */
export function paintSegment(drawing: DrawingData, from: Point, to: Point, size: number, mode: StrokeMode): Rect | null {
  return paintVariableSegment(drawing, from, to, size, size, mode);
}

/**
 * Draws a round-capped segment whose diameter (and, for `paint` with a `style`,
 * opacity) changes linearly with position.
 */
export function paintVariableSegment(
  drawing: DrawingData,
  from: Point,
  to: Point,
  startSize: number,
  endSize: number,
  mode: StrokeMode,
  style?: SegmentStyle
): Rect | null {
  if (mode.kind === 'erase' && drawing.data === null) {
    return null;
  }
  const maxRadius = Math.max(startSize, endSize, 1) / 2;
  const pad = maxRadius + 1;
  const bounds = clipRect(
    {
      x: Math.floor(Math.min(from.x, to.x) - pad),
      y: Math.floor(Math.min(from.y, to.y) - pad),
      width: Math.ceil(Math.abs(to.x - from.x) + 2 * pad) + 1,
      height: Math.ceil(Math.abs(to.y - from.y) + 2 * pad) + 1
    },
    drawing.width,
    drawing.height
  );
  if (bounds === null) {
    return null;
  }

  const data = ensureData(drawing);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let t = 0;
      if (lengthSquared > 0) {
        t = Math.min(1, Math.max(0, ((px - from.x) * dx + (py - from.y) * dy) / lengthSquared));
      }
      const radius = (Math.max(1, startSize) + (Math.max(1, endSize) - Math.max(1, startSize)) * t) / 2;
      const reach = radius + 0.5;
      const reachSquared = reach * reach;
      const nx = from.x + t * dx - px;
      const ny = from.y + t * dy - py;
      const distanceSquared = nx * nx + ny * ny;
      if (distanceSquared > reachSquared) {
        continue;
      }
      const distance = Math.sqrt(distanceSquared);
      const coverage = Math.min(1, Math.max(0, reach - distance));
      if (coverage <= 0) {
        continue;
      }
      const index = (y * drawing.width + x) * 4;
      if (style !== undefined && mode.kind === 'paint') {
        const shaped = style.grain?.(x, y, coverage, distance / reach) ?? coverage;
        applyPeakAlpha(data, index, shaped * (style.start + (style.end - style.start) * t), mode.color, style);
      } else {
        applyCoverage(data, index, coverage, mode);
      }
    }
  }
  return bounds;
}

function applyPeakAlpha(data: Uint8ClampedArray, index: number, alpha: number, color: Rgb, style: SegmentStyle): void {
  const pixel = index / 4;
  const level = Math.round(alpha * 255);
  if (level <= (style.peak[pixel] as number)) {
    return;
  }
  style.peak[pixel] = level;
  blendOver(data, index, color, alpha, style.original);
}

function applyCoverage(data: Uint8ClampedArray, index: number, coverage: number, mode: StrokeMode): void {
  if (mode.kind === 'erase') {
    const alpha = data[index + 3] as number;
    if (alpha === 0) {
      return;
    }
    const remaining = coverage >= 1 ? 0 : Math.round(alpha * (1 - coverage));
    if (remaining === 0) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
    }
    data[index + 3] = remaining;
    return;
  }

  blendOver(data, index, mode.color, coverage, data);
}

/** Writes `color` at `sourceAlpha` over the pixel found in `base` (transparent when `null`) into `data`. */
function blendOver(
  data: Uint8ClampedArray,
  index: number,
  [red, green, blue]: Rgb,
  sourceAlpha: number,
  base: Uint8ClampedArray | null
): void {
  if (sourceAlpha >= 0.999) {
    data[index] = red;
    data[index + 1] = green;
    data[index + 2] = blue;
    data[index + 3] = 255;
    return;
  }
  const destinationAlpha = base === null ? 0 : (base[index + 3] as number) / 255;
  const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outAlpha * 255 < 0.5) {
    return;
  }
  const blend = (source: number, offset: number): number => {
    const destination = base === null ? 0 : (base[index + offset] as number);
    return Math.round((source * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha)) / outAlpha);
  };
  data[index] = blend(red, 0);
  data[index + 1] = blend(green, 1);
  data[index + 2] = blend(blue, 2);
  data[index + 3] = Math.round(outAlpha * 255);
}
