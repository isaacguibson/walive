import type { DrawingData, Point, Rect, Rgb } from '../model';
import { clipRect, ensureData } from './raster';

export type StrokeMode = { readonly kind: 'paint'; readonly color: Rgb } | { readonly kind: 'erase' };

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
  if (mode.kind === 'erase' && drawing.data === null) {
    return null;
  }
  const radius = size / 2;
  const pad = radius + 1;
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
  const reach = radius + 0.5;
  const reachSquared = reach * reach;

  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let t = 0;
      if (lengthSquared > 0) {
        t = Math.min(1, Math.max(0, ((px - from.x) * dx + (py - from.y) * dy) / lengthSquared));
      }
      const nx = from.x + t * dx - px;
      const ny = from.y + t * dy - py;
      const distanceSquared = nx * nx + ny * ny;
      if (distanceSquared > reachSquared) {
        continue;
      }
      const coverage = Math.min(1, Math.max(0, reach - Math.sqrt(distanceSquared)));
      if (coverage <= 0) {
        continue;
      }
      applyCoverage(data, (y * drawing.width + x) * 4, coverage, mode);
    }
  }
  return bounds;
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

  const [red, green, blue] = mode.color;
  if (coverage >= 0.999) {
    data[index] = red;
    data[index + 1] = green;
    data[index + 2] = blue;
    data[index + 3] = 255;
    return;
  }
  const sourceAlpha = coverage;
  const destinationAlpha = (data[index + 3] as number) / 255;
  const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outAlpha * 255 < 0.5) {
    return;
  }
  const blend = (source: number, destination: number): number =>
    Math.round((source * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha)) / outAlpha);
  data[index] = blend(red, data[index] as number);
  data[index + 1] = blend(green, data[index + 1] as number);
  data[index + 2] = blend(blue, data[index + 2] as number);
  data[index + 3] = Math.round(outAlpha * 255);
}
