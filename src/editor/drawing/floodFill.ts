import type { DrawingData, Rect, Rgb } from '../model';
import { ensureData } from './raster';

const packBuffer = new Uint32Array(1);
const packBytes = new Uint8Array(packBuffer.buffer);

function pack(red: number, green: number, blue: number, alpha: number): number {
  packBytes[0] = red;
  packBytes[1] = green;
  packBytes[2] = blue;
  packBytes[3] = alpha;
  return packBuffer[0] as number;
}

/**
 * Fills the 4-connected area of identical pixels that contains `(startX, startY)`
 * with an opaque `color` (scanline algorithm). Only the given drawing is changed.
 *
 * Returns the bounding box of the filled area, or `null` when the start point is
 * outside the drawing or already has the fill color.
 */
export function floodFill(drawing: DrawingData, startX: number, startY: number, color: Rgb): Rect | null {
  const { width, height } = drawing;
  const x0 = Math.floor(startX);
  const y0 = Math.floor(startY);
  if (!(x0 >= 0 && y0 >= 0 && x0 < width && y0 < height)) {
    return null;
  }

  const data = ensureData(drawing);
  const pixels = new Uint32Array(data.buffer, data.byteOffset, width * height);
  const fill = pack(color[0], color[1], color[2], 255);
  const target = pixels[y0 * width + x0] as number;
  if (target === fill) {
    return null;
  }

  let minX = x0;
  let maxX = x0;
  let minY = y0;
  let maxY = y0;
  const stack: number[] = [x0, y0];

  while (stack.length > 0) {
    const y = stack.pop() as number;
    let x = stack.pop() as number;
    const row = y * width;

    while (x > 0 && pixels[row + x - 1] === target) {
      x -= 1;
    }
    const spanStart = x;
    let seededAbove = false;
    let seededBelow = false;

    while (x < width && pixels[row + x] === target) {
      pixels[row + x] = fill;
      if (y > 0) {
        const matches = pixels[row - width + x] === target;
        if (matches && !seededAbove) {
          stack.push(x, y - 1);
        }
        seededAbove = matches;
      }
      if (y < height - 1) {
        const matches = pixels[row + width + x] === target;
        if (matches && !seededBelow) {
          stack.push(x, y + 1);
        }
        seededBelow = matches;
      }
      x += 1;
    }

    minX = Math.min(minX, spanStart);
    maxX = Math.max(maxX, x - 1);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
