import { describe, expect, it } from 'vitest';
import { getPixel } from '@editor/drawing/raster';
import { fitPlacementRect, movePlacement, MIN_PLACEMENT_SIZE, resizePlacement } from '@editor/placement';
import { makeSession, SIZE } from './helpers';

const W = 200;
const H = 100;
const T = 10;

describe('fitPlacementRect', () => {
  it('keeps the original size when the image fits and centers it', () => {
    expect(fitPlacementRect(W, H, 40, 20)).toEqual({ x: 80, y: 40, width: 40, height: 20 });
  });

  it('scales a large image down to fit while keeping its aspect ratio', () => {
    expect(fitPlacementRect(W, H, 400, 100)).toEqual({ x: 0, y: 25, width: 200, height: 50 });
  });

  it('centers on the drop point and stays inside the canvas', () => {
    expect(fitPlacementRect(W, H, 40, 20, { x: 100, y: 50 })).toEqual({ x: 80, y: 40, width: 40, height: 20 });
    expect(fitPlacementRect(W, H, 40, 20, { x: 2, y: 2 })).toEqual({ x: 0, y: 0, width: 40, height: 20 });
    expect(fitPlacementRect(W, H, 40, 20, { x: 199, y: 99 })).toEqual({ x: 160, y: 80, width: 40, height: 20 });
  });
});

describe('movePlacement', () => {
  const start = { x: 50, y: 30, width: 40, height: 20 };

  it('moves freely when far from any border', () => {
    expect(movePlacement(start, 7, -3, W, H, T)).toEqual({ x: 57, y: 27, width: 40, height: 20 });
  });

  it('snaps the left and top edges to the canvas borders', () => {
    expect(movePlacement(start, -45, -26, W, H, T)).toEqual({ x: 0, y: 0, width: 40, height: 20 });
  });

  it('snaps the right and bottom edges to the canvas borders', () => {
    expect(movePlacement(start, 105, 46, W, H, T)).toEqual({ x: 160, y: 80, width: 40, height: 20 });
  });

  it('snaps into a corner when both axes are close', () => {
    expect(movePlacement(start, 108, 53, W, H, T)).toEqual({ x: 160, y: 80, width: 40, height: 20 });
    expect(movePlacement(start, -48, -33, W, H, T)).toEqual({ x: 0, y: 0, width: 40, height: 20 });
  });

  it('snaps the center of the image to the center of the canvas', () => {
    expect(movePlacement(start, 33, 17, W, H, T)).toEqual({ x: 80, y: 40, width: 40, height: 20 });
  });

  it('does not snap outside the threshold', () => {
    expect(movePlacement(start, -32, 0, W, H, T).x).toBe(18);
  });

  it('allows the image to extend past the canvas', () => {
    expect(movePlacement(start, -100, 0, W, H, T).x).toBe(-50);
  });
});

describe('resizePlacement', () => {
  const start = { x: 50, y: 30, width: 40, height: 20 };

  it('stretches freely from a side handle and keeps the other side fixed', () => {
    expect(resizePlacement(start, 'e', 15, 99, W, H, T)).toEqual({ x: 50, y: 30, width: 55, height: 20 });
    expect(resizePlacement(start, 'w', -15, 99, W, H, T)).toEqual({ x: 35, y: 30, width: 55, height: 20 });
    expect(resizePlacement(start, 's', 99, 12, W, H, T)).toEqual({ x: 50, y: 30, width: 40, height: 32 });
    expect(resizePlacement(start, 'n', 99, -12, W, H, T)).toEqual({ x: 50, y: 18, width: 40, height: 32 });
  });

  it('keeps the aspect ratio when dragging a corner', () => {
    expect(resizePlacement(start, 'se', 20, 0, W, H, T)).toEqual({ x: 50, y: 30, width: 60, height: 30 });
    expect(resizePlacement(start, 'nw', -20, 0, W, H, T)).toEqual({ x: 30, y: 20, width: 60, height: 30 });
  });

  it('stretches from a corner when the aspect ratio is not kept', () => {
    expect(resizePlacement(start, 'se', 20, 5, W, H, T, false)).toEqual({ x: 50, y: 30, width: 60, height: 25 });
  });

  it('snaps the dragged edge to a canvas border', () => {
    expect(resizePlacement(start, 'w', -45, 0, W, H, T)).toEqual({ x: 0, y: 30, width: 90, height: 20 });
    expect(resizePlacement(start, 'e', 105, 0, W, H, T)).toEqual({ x: 50, y: 30, width: 150, height: 20 });
    expect(resizePlacement(start, 'n', 0, -26, W, H, T)).toEqual({ x: 50, y: 0, width: 40, height: 50 });
  });

  it('snaps a corner to the border while keeping the aspect ratio', () => {
    // Dragging the bottom-right corner to x = 195 snaps to the right border (200).
    const roomy = { x: 50, y: 10, width: 40, height: 10 };
    const result = resizePlacement(roomy, 'se', 105, 0, W, H, T);
    expect(result.x + result.width).toBe(200);
    expect(result.width / result.height).toBeCloseTo(4, 0);
  });

  it('prefers the closest border when a corner is near two of them', () => {
    // The corner would land at (195, 102.5): the bottom border is closer than the right one.
    const result = resizePlacement(start, 'se', 105, 0, W, H, T);
    expect(result.y + result.height).toBe(100);
    expect(result.width / result.height).toBeCloseTo(2, 1);
  });

  it('never makes the image smaller than the minimum size', () => {
    const side = resizePlacement(start, 'e', -500, 0, W, H, T);
    expect(side.width).toBe(MIN_PLACEMENT_SIZE);
    const corner = resizePlacement(start, 'se', -500, -500, W, H, T);
    expect(Math.min(corner.width, corner.height)).toBeGreaterThanOrEqual(MIN_PLACEMENT_SIZE);
    expect(corner.x).toBe(50);
    expect(corner.y).toBe(30);
  });
});

describe('placing an image through the session', () => {
  function pixelsWithRed(): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
    pixels.set([255, 0, 0, 255], 0);
    return pixels;
  }

  it('adds the layer as one undoable step and returns its id', () => {
    const session = makeSession();
    const id = session.addLayerFromPixels('hero', pixelsWithRed());

    const snapshot = session.getSnapshot();
    expect(id).not.toBeNull();
    expect(snapshot.activeFrame.layers.some((layer) => layer.id === id && layer.name === 'hero')).toBe(true);
    expect(snapshot.canUndo).toBe(true);

    session.undo();
    expect(session.hasActiveFrameLayer(id as string)).toBe(false);
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('updates the pixels without adding history entries and notifies the renderer', () => {
    const session = makeSession();
    const id = session.addLayerFromPixels('hero', pixelsWithRed()) as string;
    let content = 0;
    session.engine.subscribeContent(() => {
      content += 1;
    });

    const moved = new Uint8ClampedArray(SIZE * SIZE * 4);
    moved.set([0, 0, 255, 255], (3 * SIZE + 3) * 4);
    expect(session.updateLayerPixels(id, moved)).toBe(true);
    expect(session.updateLayerPixels(id, moved)).toBe(true);

    const layer = session.getSnapshot().activeFrame.layers.find((candidate) => candidate.id === id);
    expect(getPixel(layer!.drawing, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(layer!.drawing, 3, 3)).toEqual([0, 0, 255, 255]);
    expect(content).toBe(2);

    // A single undo removes the whole image, not just the last move.
    session.undo();
    expect(session.hasActiveFrameLayer(id)).toBe(false);
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('keeps the document unsaved when the image moves after a save', () => {
    const session = makeSession();
    const id = session.addLayerFromPixels('hero', pixelsWithRed()) as string;
    session.markSaved(session.createSaveRequest().token);
    expect(session.getSnapshot().isDirty).toBe(false);

    session.updateLayerPixels(id, new Uint8ClampedArray(SIZE * SIZE * 4));
    expect(session.getSnapshot().isDirty).toBe(true);
  });

  it('rejects an update for a layer that no longer exists', () => {
    const session = makeSession();
    const id = session.addLayerFromPixels('hero', pixelsWithRed()) as string;
    session.undo();
    expect(session.updateLayerPixels(id, new Uint8ClampedArray(SIZE * SIZE * 4))).toBe(false);
    expect(session.getSnapshot().error).not.toBeNull();
  });
});
