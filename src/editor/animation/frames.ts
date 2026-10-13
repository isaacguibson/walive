import { CurveCache } from '../curves/render';
import { cloneDrawing, createDrawing, layerDrawings } from '../drawing/raster';
import type { Frame, Layer } from '../model';

export function createLayer(id: string, name: string, width: number, height: number): Layer {
  return createLayerFromDrawing(id, name, createDrawing(width, height));
}

export function createLayerFromDrawing(id: string, name: string, drawing: Layer['drawing']): Layer {
  return { id, name, visible: true, drawing, curves: [], curveCache: new CurveCache(drawing.width, drawing.height) };
}

/** Deep copy of a layer (independent pixels and curves) under a new identifier. */
export function cloneLayer(layer: Layer, id: string): Layer {
  const drawing = cloneDrawing(layer.drawing);
  // Curves are immutable values, so the copy can share them; it only needs its own raster.
  return { id, name: layer.name, visible: layer.visible, drawing, curves: layer.curves, curveCache: new CurveCache(drawing.width, drawing.height) };
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

/** Content key of a frame: changes whenever its structure, pixels or curves change. */
export function frameContentKey(frame: Frame): string {
  return frame.layers
    .map((layer) => {
      const rasters = layerDrawings(layer).map((drawing) => `${drawing.revision}:${drawing.data === null ? 0 : 1}`);
      return `${layer.id}:${layer.visible ? 1 : 0}:${rasters.join('+')}`;
    })
    .join('|');
}
