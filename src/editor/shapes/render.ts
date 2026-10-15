import type { BrushCanvas, BrushSample } from '../brushes/brush';
import { basicBrush } from '../brushes/basicBrush';
import { clipRect, ensureData } from '../drawing/raster';
import type { Point, Rect } from '../model';
import { parseHexColor } from '../validation';
import { shapeOutline, type Shape } from './geometry';

const ROW_SAMPLES = 4;

/** Coverage (0-1) of every pixel of `area` by a convex polygon: exact across, `ROW_SAMPLES` per pixel down. */
function polygonCoverage(points: readonly Point[], area: Rect): Float32Array {
  const coverage = new Float32Array(area.width * area.height);
  for (let row = 0; row < area.height; row += 1) {
    for (let sample = 0; sample < ROW_SAMPLES; sample += 1) {
      const y = area.y + row + (sample + 0.5) / ROW_SAMPLES;
      let left = Infinity;
      let right = -Infinity;
      for (let index = 0; index < points.length; index += 1) {
        const from = points[index] as Point;
        const to = points[(index + 1) % points.length] as Point;
        if ((from.y <= y && to.y > y) || (to.y <= y && from.y > y)) {
          const x = from.x + ((y - from.y) * (to.x - from.x)) / (to.y - from.y);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
      for (let column = Math.max(area.x, Math.floor(left)); column < Math.min(area.x + area.width, Math.ceil(right)); column += 1) {
        const overlap = Math.min(column + 1, right) - Math.max(column, left);
        const at = row * area.width + (column - area.x);
        coverage[at] = (coverage[at] ?? 0) + overlap / ROW_SAMPLES;
      }
    }
  }
  return coverage;
}

function fillShape(points: readonly Point[], color: readonly [number, number, number], opacity: number, canvas: BrushCanvas): void {
  canvas.apply((drawing) => {
    const bounds = {
      minX: Math.min(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxX: Math.max(...points.map((point) => point.x)),
      maxY: Math.max(...points.map((point) => point.y))
    };
    const area = clipRect(
      { x: Math.floor(bounds.minX), y: Math.floor(bounds.minY), width: Math.ceil(bounds.maxX) - Math.floor(bounds.minX), height: Math.ceil(bounds.maxY) - Math.floor(bounds.minY) },
      drawing.width,
      drawing.height
    );
    if (area === null) {
      return null;
    }
    const coverage = polygonCoverage(points, area);
    const target = ensureData(drawing);
    for (let row = 0; row < area.height; row += 1) {
      for (let column = 0; column < area.width; column += 1) {
        const alpha = Math.min(1, coverage[row * area.width + column] as number) * opacity;
        if (alpha <= 0) {
          continue;
        }
        const index = ((area.y + row) * drawing.width + area.x + column) * 4;
        const below = (target[index + 3] as number) / 255;
        const result = alpha + below * (1 - alpha);
        for (let channel = 0; channel < 3; channel += 1) {
          target[index + channel] = Math.round(((color[channel] as number) * alpha + (target[index + channel] as number) * below * (1 - alpha)) / result);
        }
        target[index + 3] = Math.round(result * 255);
      }
    }
    return area;
  });
}

function outlineShape(points: readonly Point[], closed: boolean, shape: Shape, canvas: BrushCanvas): void {
  const opacity = shape.opacity / 100;
  const stroke = basicBrush.startStroke({}, { canvas, color: parseHexColor(shape.color) ?? [0, 0, 0], seed: 0, variableOpacity: opacity < 1 });
  const sample = (point: Point): BrushSample => ({ x: point.x, y: point.y, size: shape.strokeWidth, opacity });
  const path = closed ? [...points, points[0] as Point] : points;
  stroke.begin(sample(path[0] as Point));
  path.slice(1).forEach((point) => stroke.extend(sample(point)));
  stroke.end();
}

/** Paints the shape on `canvas` with the raster pipeline of the brush, so the result is ordinary artwork. */
export function paintShape(shape: Shape, canvas: BrushCanvas): void {
  const points = shapeOutline(shape);
  if (shape.kind === 'line') {
    outlineShape(points, false, shape, canvas);
  } else if (shape.fill) {
    fillShape(points, parseHexColor(shape.color) ?? [0, 0, 0], shape.opacity / 100, canvas);
  } else {
    outlineShape(points, true, shape, canvas);
  }
}
