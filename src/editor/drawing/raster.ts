import type { DrawingData, Layer, Rect, Rgba } from '../model';

export function createDrawing(width: number, height: number): DrawingData {
  return { width, height, data: null, revision: 0, dirty: null };
}

/** Allocates the pixel buffer on first use so blank layers cost no memory. */
export function ensureData(drawing: DrawingData): Uint8ClampedArray {
  if (drawing.data === null) {
    drawing.data = new Uint8ClampedArray(drawing.width * drawing.height * 4);
  }
  return drawing.data;
}

/** Deep copy: the result shares no pixel memory with the source. */
export function cloneDrawing(drawing: DrawingData): DrawingData {
  return {
    width: drawing.width,
    height: drawing.height,
    data: drawing.data === null ? null : new Uint8ClampedArray(drawing.data),
    revision: 0,
    dirty: null
  };
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

/** Intersects a rectangle with `[0, width) x [0, height)`. Returns `null` when nothing remains. */
export function clipRect(rect: Rect, width: number, height: number): Rect | null {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(width, rect.x + rect.width);
  const bottom = Math.min(height, rect.y + rect.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** Records that `rect` changed, bumping the revision renderers watch. */
export function markDirty(drawing: DrawingData, rect: Rect): void {
  drawing.revision += 1;
  drawing.dirty = drawing.dirty === null ? rect : unionRect(drawing.dirty, rect);
}

/** Returns and resets the accumulated dirty rectangle. */
export function consumeDirty(drawing: DrawingData): Rect | null {
  const dirty = drawing.dirty;
  drawing.dirty = null;
  return dirty;
}

/** Copies a rectangular region out of a pixel buffer (zeros when the buffer is `null`). */
export function extractRegion(source: Uint8ClampedArray | null, width: number, rect: Rect): Uint8ClampedArray {
  const region = new Uint8ClampedArray(rect.width * rect.height * 4);
  if (source === null) {
    return region;
  }
  const rowBytes = rect.width * 4;
  for (let row = 0; row < rect.height; row += 1) {
    const start = ((rect.y + row) * width + rect.x) * 4;
    region.set(source.subarray(start, start + rowBytes), row * rowBytes);
  }
  return region;
}

export function readRegion(drawing: DrawingData, rect: Rect): Uint8ClampedArray {
  return extractRegion(drawing.data, drawing.width, rect);
}

export function writeRegion(drawing: DrawingData, rect: Rect, pixels: Uint8ClampedArray): void {
  const target = ensureData(drawing);
  const rowBytes = rect.width * 4;
  for (let row = 0; row < rect.height; row += 1) {
    const start = ((rect.y + row) * drawing.width + rect.x) * 4;
    target.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), start);
  }
}

export function getPixel(drawing: DrawingData, x: number, y: number): Rgba {
  const data = drawing.data;
  if (data === null || x < 0 || y < 0 || x >= drawing.width || y >= drawing.height) {
    return [0, 0, 0, 0];
  }
  const index = (y * drawing.width + x) * 4;
  return [data[index] as number, data[index + 1] as number, data[index + 2] as number, data[index + 3] as number];
}

/** True when no pixel has any opacity. */
export function isDrawingBlank(drawing: DrawingData): boolean {
  const data = drawing.data;
  if (data === null) {
    return true;
  }
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * Color of the visible composite of `layers` at a pixel (source-over, bottom
 * layer first). Returns `null` when the pixel is fully transparent.
 */
export function compositePixel(layers: readonly Layer[], x: number, y: number): Rgba | null {
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index] as Layer;
    if (!layer.visible) {
      continue;
    }
    const [sr, sg, sb, sa8] = getPixel(layer.drawing, x, y);
    if (sa8 === 0) {
      continue;
    }
    const sa = sa8 / 255;
    red = sr * sa + red * (1 - sa);
    green = sg * sa + green * (1 - sa);
    blue = sb * sa + blue * (1 - sa);
    alpha = sa + alpha * (1 - sa);
  }
  if (alpha === 0) {
    return null;
  }
  return [Math.round(red / alpha), Math.round(green / alpha), Math.round(blue / alpha), Math.round(alpha * 255)];
}
