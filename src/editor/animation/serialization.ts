import { createDrawing, isDrawingBlank } from '../drawing/raster';
import { EditorError } from '../errors';
import type { Frame } from '../model';
import type { AnimationDocument } from '@shared/types/animation';

/** Converts the in-memory animation to the transport/storage representation. Blank layers carry no pixels. */
export function toAnimationDocument(width: number, height: number, frames: readonly Frame[]): AnimationDocument {
  return {
    width,
    height,
    frames: frames.map((frame) => ({
      id: frame.id,
      layers: frame.layers.map((layer) => {
        const data = layer.drawing.data;
        return {
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          pixels: data === null || isDrawingBlank(layer.drawing) ? null : new Uint8Array(data.buffer, data.byteOffset, data.length)
        };
      })
    }))
  };
}

/** Rebuilds frames from a stored document. The stored canvas size must match the project canvas. */
export function framesFromAnimationDocument(document: AnimationDocument, width: number, height: number): Frame[] {
  if (document.width !== width || document.height !== height) {
    throw new EditorError('CANVAS_MISMATCH', 'The stored drawings do not match the canvas size of this project.');
  }
  const expectedLength = width * height * 4;
  return document.frames.map((frame) => ({
    id: frame.id,
    layers: frame.layers.map((layer) => {
      const drawing = createDrawing(width, height);
      if (layer.pixels !== null) {
        if (layer.pixels.length !== expectedLength) {
          throw new EditorError('INVALID_VALUE', 'The stored drawing data is not valid.');
        }
        // Copy: the editor mutates pixels in place and must not alias transport buffers.
        drawing.data = new Uint8ClampedArray(layer.pixels);
      }
      return { id: layer.id, name: layer.name, visible: layer.visible, drawing };
    })
  }));
}
