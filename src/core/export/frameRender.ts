import { framesFromAnimationDocument } from '@editor/animation/serialization';
import type { Frame } from '@editor/model';
import { renderFrameThumbnail } from '@editor/thumbnail';
import type { AnimationFrameData } from '@shared/types/animation';
import type { ExportBackground, ExportResolution } from '@shared/types/export';

export interface Size {
  width: number;
  height: number;
}

export function outputSize(canvas: Size, resolution: ExportResolution): Size {
  return resolution.mode === 'original' ? canvas : { width: resolution.width, height: resolution.height };
}

function flattenOnto(pixels: Uint8ClampedArray, color: string): void {
  const background = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] as number;
    if (alpha === 255) {
      continue;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      pixels[index + channel] = Math.round(
        ((pixels[index + channel] as number) * alpha + (background[channel] as number) * (255 - alpha)) / 255
      );
    }
    pixels[index + 3] = 255;
  }
}

/**
 * Renders the visible artwork of a stored frame (layers and Bézier curves, nothing from the editing
 * UI) at `size`. Returns non-premultiplied RGBA; with a color background every pixel ends up opaque.
 */
export function renderFrame(frame: AnimationFrameData, canvas: Size, size: Size, background: ExportBackground): Uint8Array {
  const [editorFrame] = framesFromAnimationDocument({ ...canvas, frames: [frame] }, canvas.width, canvas.height) as [Frame];
  const pixels = renderFrameThumbnail(editorFrame, canvas.width, canvas.height, size.width, size.height);
  if (background.type === 'color') {
    flattenOnto(pixels, background.color);
  }
  return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length);
}
