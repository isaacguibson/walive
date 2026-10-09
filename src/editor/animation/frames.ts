import { cloneDrawing, createDrawing } from '../drawing/raster';
import type { Frame, Layer } from '../model';

export function createLayer(id: string, name: string, width: number, height: number): Layer {
  return { id, name, visible: true, drawing: createDrawing(width, height) };
}

export function createLayerFromDrawing(id: string, name: string, drawing: Layer['drawing']): Layer {
  return { id, name, visible: true, drawing };
}

/** Deep copy of a layer (independent pixels) under a new identifier. */
export function cloneLayer(layer: Layer, id: string): Layer {
  return { id, name: layer.name, visible: layer.visible, drawing: cloneDrawing(layer.drawing) };
}

/**
 * Deep copy of a frame. Every layer receives a fresh identifier because layer
 * ids must be unique across the whole project (they name stored drawings).
 */
export function cloneFrame(frame: Frame, frameId: string, newId: () => string): Frame {
  return { id: frameId, layers: frame.layers.map((layer) => cloneLayer(layer, newId())) };
}

/** Smallest `Layer N` name not already used in `layers`. */
export function nextLayerName(layers: readonly Layer[], prefix: string): string {
  const used = new Set(layers.map((layer) => layer.name));
  let number = layers.length + 1;
  while (used.has(`${prefix} ${number}`)) {
    number += 1;
  }
  return `${prefix} ${number}`;
}

/** Content key of a frame: changes whenever its structure or pixels change. */
export function frameContentKey(frame: Frame): string {
  return frame.layers
    .map((layer) => `${layer.id}:${layer.visible ? 1 : 0}:${layer.drawing.revision}:${layer.drawing.data === null ? 0 : 1}`)
    .join('|');
}
