import { compositePixel } from './drawing/raster';
import type { Frame } from './model';

/** Size of a thumbnail that fits `maxEdge` while keeping the canvas aspect ratio (at least 1x1). */
export function thumbnailSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

/**
 * Renders a small RGBA preview of the visible composite of a frame by sampling
 * the layers (nearest neighbor). Cost depends on the thumbnail size, not on the canvas size.
 */
export function renderFrameThumbnail(
  frame: Frame,
  canvasWidth: number,
  canvasHeight: number,
  thumbWidth: number,
  thumbHeight: number
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(thumbWidth * thumbHeight * 4);
  for (let y = 0; y < thumbHeight; y += 1) {
    const sourceY = Math.min(canvasHeight - 1, Math.floor(((y + 0.5) * canvasHeight) / thumbHeight));
    for (let x = 0; x < thumbWidth; x += 1) {
      const sourceX = Math.min(canvasWidth - 1, Math.floor(((x + 0.5) * canvasWidth) / thumbWidth));
      const color = compositePixel(frame.layers, sourceX, sourceY);
      if (color !== null) {
        const index = (y * thumbWidth + x) * 4;
        pixels[index] = color[0];
        pixels[index + 1] = color[1];
        pixels[index + 2] = color[2];
        pixels[index + 3] = color[3];
      }
    }
  }
  return pixels;
}
