import { compositePixel } from '@editor/drawing/raster';
import type { Frame } from '@editor/model';

export interface RenderedFrame {
  width: number;
  height: number;
  /** The frame over a white background, opaque. */
  rgba: Uint8ClampedArray;
  /** One byte per pixel: 1 where the frame has any artwork. */
  covered: Uint8Array;
  /** Output pixels per canvas pixel. */
  scale: number;
}

const GRID = 16;

/** Renders the visible composite of `frame` with nearest-neighbor sampling, fitted to `maxSize`. */
export function renderFrame(frame: Frame, canvasWidth: number, canvasHeight: number, maxSize: number): RenderedFrame {
  const scale = maxSize / Math.max(canvasWidth, canvasHeight);
  const width = Math.max(1, Math.round(canvasWidth * scale));
  const height = Math.max(1, Math.round(canvasHeight * scale));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const covered = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = compositePixel(frame.layers, Math.min(canvasWidth - 1, Math.floor(x / scale)), Math.min(canvasHeight - 1, Math.floor(y / scale)));
      const [r, g, b, a] = pixel ?? [0, 0, 0, 0];
      const alpha = a / 255;
      const index = y * width + x;
      rgba[index * 4] = Math.round(r * alpha + 255 * (1 - alpha));
      rgba[index * 4 + 1] = Math.round(g * alpha + 255 * (1 - alpha));
      rgba[index * 4 + 2] = Math.round(b * alpha + 255 * (1 - alpha));
      rgba[index * 4 + 3] = 255;
      covered[index] = a > 0 ? 1 : 0;
    }
  }
  return { width, height, rgba, covered, scale };
}

const hex = (value: number): string => value.toString(16).padStart(2, '0');

/** Text description of a rendering, for models that cannot look at the picture. */
export function describeRendering(frame: RenderedFrame, canvasWidth: number, canvasHeight: number): string {
  const { width, height, rgba, covered, scale } = frame;
  let count = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const colors = new Map<string, number>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (covered[index] === 0) {
        continue;
      }
      count += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      // Quantized to 16 levels per channel so that near colors count together.
      const key = `#${[0, 1, 2].map((channel) => hex(Math.round((rgba[index * 4 + channel] as number) / 17) * 17)).join('')}`;
      colors.set(key, (colors.get(key) ?? 0) + 1);
    }
  }
  if (count === 0) {
    return `Canvas ${canvasWidth}x${canvasHeight}. The frame has no visible artwork.`;
  }
  const percent = Math.round((count / (width * height)) * 100);
  const palette = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([color, n]) => `${color} (${Math.round((n / count) * 100)}%)`);
  const bounds = `x ${Math.floor(minX / scale)}-${Math.min(canvasWidth - 1, Math.floor(maxX / scale))}, y ${Math.floor(minY / scale)}-${Math.min(canvasHeight - 1, Math.floor(maxY / scale))}`;

  const cellWidth = Math.max(1, Math.ceil(width / GRID));
  const cellHeight = Math.max(1, Math.ceil(height / GRID));
  const rows: string[] = [];
  for (let top = 0; top < height; top += cellHeight) {
    let row = '';
    for (let left = 0; left < width; left += cellWidth) {
      let filled = 0;
      let total = 0;
      for (let y = top; y < Math.min(height, top + cellHeight); y += 1) {
        for (let x = left; x < Math.min(width, left + cellWidth); x += 1) {
          total += 1;
          filled += covered[y * width + x] as number;
        }
      }
      row += filled * 2 >= total ? '#' : filled > 0 ? '+' : '.';
    }
    rows.push(row);
  }
  return [
    `Canvas ${canvasWidth}x${canvasHeight}. Artwork covers ${percent}% of the canvas, within ${bounds}.`,
    `Main colors: ${palette.join(', ')}.`,
    `Occupancy grid (top to bottom; # mostly covered, + partly, . empty):`,
    ...rows
  ].join('\n');
}

/** Encodes a rendering as PNG (base64) through a canvas; `null` when the environment cannot. */
export function encodePng(frame: RenderedFrame): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext('2d');
    if (context === null) {
      return null;
    }
    context.putImageData(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height), 0, 0);
    const url = canvas.toDataURL('image/png');
    return url.startsWith('data:image/png;base64,') ? url.slice('data:image/png;base64,'.length) : null;
  } catch {
    return null;
  }
}
