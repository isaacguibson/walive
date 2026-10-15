import { describe, expect, it } from 'vitest';
import { framesFromAnimationDocument } from '@editor/animation/serialization';
import { ensureData, getPixel, readRegion } from '@editor/drawing/raster';
import type { EditorSession } from '@editor/editorSession';
import type { Rect, Rgba, SelectionResampling } from '@editor/model';
import { click, drag, makeSession, paintRed, pixelAt, RED, SIZE, TRANSPARENT } from './helpers';

const BLUE: Rgba = [0, 0, 255, 255];
const BLOCK: Rect = { x: 2, y: 2, width: 4, height: 4 };

function paint(session: EditorSession, rect: Rect, color: Rgba, layer = session.getSnapshot().activeLayer): void {
  const data = ensureData(layer.drawing);
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      data.set(color, (y * SIZE + x) * 4);
    }
  }
}

/** A session with a red 4x4 block at (2, 2) on the layer and that block selected. */
function selectedBlock(): EditorSession {
  const session = makeSession();
  paint(session, BLOCK, RED);
  session.selectTool('select');
  drag(session, [2, 2], [6, 6]);
  return session;
}

const selection = (session: EditorSession) => session.getSnapshot().state.selection;

/** Moves the selected block by `dx` pixels, with the middle of the block as the grab point. */
function moveBy(session: EditorSession, dx: number, dy = 0): void {
  drag(session, [4, 4], [4 + dx, 4 + dy]);
}

describe('selecting', () => {
  it('is offered with the default options', () => {
    const session = makeSession();
    session.selectTool('select');
    expect(session.getSnapshot().state.selectedTool).toBe('select');
    expect(session.getSnapshot().state.selectionOptions).toEqual({ keepAspectRatio: false, resampling: 'smooth' });
  });

  it('selects the dragged area without touching the layer or the history', () => {
    const session = selectedBlock();
    expect(selection(session)).toEqual({ rect: BLOCK, creating: false, pending: false, angle: 0 });
    expect(pixelAt(session, 3, 3)).toEqual(RED);
    expect(session.getSnapshot().canUndo).toBe(false);
    expect(session.getSnapshot().isDirty).toBe(false);
  });

  it('shows the area while it is being dragged', () => {
    const session = makeSession();
    session.selectTool('select');
    session.pointerDown({ x: 2, y: 2, pointerId: 1, buttons: 1 });
    session.pointerMove({ x: 6, y: 5, pointerId: 1, buttons: 1 });
    expect(selection(session)).toEqual({ rect: { x: 2, y: 2, width: 4, height: 3 }, creating: true, pending: false, angle: 0 });
    session.pointerUp({ x: 6, y: 5, pointerId: 1, buttons: 0 });
    expect(selection(session)?.creating).toBe(false);
  });

  it('discards a click and a zero-size drag', () => {
    const session = makeSession();
    session.selectTool('select');
    click(session, 5, 5);
    expect(selection(session)).toBeNull();
    drag(session, [5, 5], [5, 9]);
    expect(selection(session)).toBeNull();
  });

  it('selects in any direction and clips to the canvas', () => {
    const session = makeSession();
    paint(session, { x: 0, y: 0, width: SIZE, height: SIZE }, RED);
    session.selectTool('select');
    drag(session, [6, 6], [2, 2]);
    expect(selection(session)?.rect).toEqual(BLOCK);
    session.cancelSelection();
    drag(session, [20, 20], [10, 10]);
    expect(selection(session)?.rect).toEqual({ x: 10, y: 10, width: 6, height: 6 });
  });

  it('does not select on a hidden layer', () => {
    const session = makeSession();
    session.setLayerVisible(session.getSnapshot().activeLayer.id, false);
    session.selectTool('select');
    drag(session, [2, 2], [6, 6]);
    expect(selection(session)).toBeNull();
    expect(session.getSnapshot().error).toMatch(/hidden/i);
  });

  it('is cleared when another tool is chosen', () => {
    const session = selectedBlock();
    session.selectTool('brush');
    expect(selection(session)).toBeNull();
  });
});

describe('moving', () => {
  it('does not move on a click inside', () => {
    const session = selectedBlock();
    click(session, 4, 4);
    expect(selection(session)).toEqual({ rect: BLOCK, creating: false, pending: false, angle: 0 });
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('shows the move as a preview and leaves the layer untouched until it is applied', () => {
    const session = selectedBlock();
    moveBy(session, 6, 2);
    expect(selection(session)).toEqual({ rect: { x: 8, y: 4, width: 4, height: 4 }, creating: false, pending: true, angle: 0 });
    expect(session.getSnapshot().canUndo).toBe(true);
    const preview = session.getSelectionPreview();
    expect(preview).toMatchObject({ source: BLOCK, rect: { x: 8, y: 4, width: 4, height: 4 } });
    expect(pixelAt(session, 3, 3)).toEqual(RED);
    expect(pixelAt(session, 9, 5)).toEqual(TRANSPARENT);
  });

  it('applies on a click outside as a single undo step, and undo and redo are exact', () => {
    const session = selectedBlock();
    moveBy(session, 6, 2);
    click(session, 15, 0);
    expect(selection(session)).toBeNull();
    expect(session.getSelectionPreview()).toBeNull();
    expect(pixelAt(session, 3, 3)).toEqual(TRANSPARENT);
    expect(pixelAt(session, 8, 4)).toEqual(RED);
    expect(pixelAt(session, 11, 7)).toEqual(RED);
    expect(pixelAt(session, 12, 7)).toEqual(TRANSPARENT);

    session.undo();
    expect(pixelAt(session, 3, 3)).toEqual(RED);
    expect(pixelAt(session, 9, 5)).toEqual(TRANSPARENT);
    expect(session.getSnapshot().canUndo).toBe(false);

    session.redo();
    expect(pixelAt(session, 3, 3)).toEqual(TRANSPARENT);
    expect(pixelAt(session, 9, 5)).toEqual(RED);
  });

  it('does not accumulate: moving back to the origin is no change at all', () => {
    const session = selectedBlock();
    moveBy(session, 6);
    drag(session, [10, 4], [4, 4]);
    expect(selection(session)).toEqual({ rect: BLOCK, creating: false, pending: false, angle: 0 });
    click(session, 15, 0);
    expect(session.getSnapshot().canUndo).toBe(false);
    expect(pixelAt(session, 3, 3)).toEqual(RED);
  });

  it('keeps the transparency of the moved pixels', () => {
    const session = makeSession();
    paint(session, BLOCK, RED);
    paint(session, { x: 4, y: 3, width: 1, height: 1 }, TRANSPARENT);
    paint(session, { x: 10, y: 3, width: 1, height: 1 }, BLUE);
    session.selectTool('select');
    drag(session, [2, 2], [6, 6]);
    moveBy(session, 6);
    click(session, 15, 0);
    // The hole of the block lets the artwork underneath show through.
    expect(pixelAt(session, 10, 3)).toEqual(BLUE);
    expect(pixelAt(session, 9, 3)).toEqual(RED);
    expect(pixelAt(session, 11, 3)).toEqual(RED);
  });

  it('blends semi-transparent pixels over the artwork underneath', () => {
    const session = makeSession();
    paint(session, BLOCK, [255, 0, 0, 128]);
    paint(session, { x: 8, y: 2, width: 4, height: 4 }, BLUE);
    session.selectTool('select');
    drag(session, [2, 2], [6, 6]);
    moveBy(session, 6);
    click(session, 15, 0);
    const [r, , b, a] = pixelAt(session, 9, 3);
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(100);
  });

  it('clips what leaves the canvas and keeps the rest exact', () => {
    const session = selectedBlock();
    moveBy(session, 30);
    expect(selection(session)?.rect.x).toBe(SIZE - 1);
    click(session, 0, 0);
    expect(pixelAt(session, 15, 3)).toEqual(RED);
    expect(pixelAt(session, 14, 3)).toEqual(TRANSPARENT);
    expect(pixelAt(session, 3, 3)).toEqual(TRANSPARENT);
    session.undo();
    expect(pixelAt(session, 3, 3)).toEqual(RED);
    expect(pixelAt(session, 15, 3)).toEqual(TRANSPARENT);
  });

  it('acts on the active layer only', () => {
    const session = makeSession();
    const lower = session.getSnapshot().activeLayer;
    session.addLayer();
    const upper = session.getSnapshot().activeLayer;
    paint(session, BLOCK, RED, lower);
    paint(session, BLOCK, BLUE, upper);
    session.selectTool('select');
    drag(session, [2, 2], [6, 6]);
    moveBy(session, 6);
    click(session, 15, 0);
    expect(getPixel(upper.drawing, 3, 3)).toEqual(TRANSPARENT);
    expect(getPixel(upper.drawing, 9, 3)).toEqual(BLUE);
    expect(getPixel(lower.drawing, 3, 3)).toEqual(RED);
    expect(getPixel(lower.drawing, 9, 3)).toEqual(TRANSPARENT);
  });

  it('creates no artwork from an empty selection', () => {
    const session = makeSession();
    session.selectTool('select');
    drag(session, [2, 2], [6, 6]);
    moveBy(session, 6);
    expect(selection(session)).toMatchObject({ pending: false });
    click(session, 15, 0);
    expect(session.getSnapshot().canUndo).toBe(false);
    expect(session.getSnapshot().isDirty).toBe(false);
  });
});

describe('resizing', () => {
  it('scales from a handle and keeps the opposite side fixed', () => {
    const session = selectedBlock();
    drag(session, [6, 6], [10, 8]);
    expect(selection(session)?.rect).toEqual({ x: 2, y: 2, width: 8, height: 6 });
  });

  it('stops at the opposite edge instead of flipping', () => {
    const session = selectedBlock();
    drag(session, [6, 4], [-20, 4]);
    expect(selection(session)?.rect).toEqual({ x: 2, y: 2, width: 1, height: 4 });
  });

  it.each<SelectionResampling>(['nearest', 'smooth'])('previews exactly what is applied (%s)', (resampling) => {
    const session = makeSession();
    paint(session, { x: 2, y: 2, width: 2, height: 4 }, RED);
    paint(session, { x: 4, y: 2, width: 2, height: 4 }, BLUE);
    session.setSelectionResampling(resampling);
    session.selectTool('select');
    drag(session, [2, 2], [6, 6]);
    drag(session, [6, 4], [11, 4]);
    const preview = session.getSelectionPreview();
    expect(preview).not.toBeNull();
    expect(preview?.rect).toEqual({ x: 2, y: 2, width: 9, height: 4 });
    click(session, 15, 15);
    const committed = readRegion(session.getSnapshot().activeLayer.drawing, { x: 2, y: 2, width: 9, height: 4 });
    expect(Array.from(committed)).toEqual(Array.from(preview?.pixels ?? []));
  });

  it('uses the chosen resampling', () => {
    const edge = (resampling: SelectionResampling): Uint8ClampedArray => {
      const session = makeSession();
      paint(session, { x: 2, y: 2, width: 1, height: 2 }, RED);
      paint(session, { x: 3, y: 2, width: 1, height: 2 }, BLUE);
      session.setSelectionResampling(resampling);
      session.selectTool('select');
      drag(session, [2, 2], [4, 4]);
      drag(session, [4, 3], [8, 3]);
      return session.getSelectionPreview()?.pixels ?? new Uint8ClampedArray();
    };
    const nearest = edge('nearest');
    const smooth = edge('smooth');
    // Nearest keeps only the two original colors; smooth creates in-between ones.
    const colors = (pixels: Uint8ClampedArray) => new Set(Array.from({ length: pixels.length / 4 }, (_, i) => pixels.slice(i * 4, i * 4 + 4).join()));
    expect(colors(nearest).size).toBe(2);
    expect(colors(smooth).size).toBeGreaterThan(2);
  });

  it('changes the pending preview when the resampling option changes', () => {
    const session = makeSession();
    paint(session, { x: 2, y: 2, width: 1, height: 2 }, RED);
    paint(session, { x: 3, y: 2, width: 1, height: 2 }, BLUE);
    session.selectTool('select');
    drag(session, [2, 2], [4, 4]);
    drag(session, [4, 3], [8, 3]);
    const smooth = session.getSelectionPreview()?.pixels;
    session.setSelectionResampling('nearest');
    expect(session.getSelectionPreview()?.pixels).not.toEqual(smooth);
  });

  it('always resamples from the originals, so a round trip loses nothing', () => {
    const session = makeSession();
    paint(session, { x: 2, y: 2, width: 1, height: 2 }, RED);
    paint(session, { x: 3, y: 2, width: 1, height: 2 }, BLUE);
    session.selectTool('select');
    drag(session, [2, 2], [4, 4]);
    drag(session, [4, 3], [9, 3]);
    drag(session, [9, 3], [4, 3]);
    expect(selection(session)).toMatchObject({ rect: { x: 2, y: 2, width: 2, height: 2 }, pending: false });
    click(session, 15, 15);
    expect(session.getSnapshot().canUndo).toBe(false);
    expect(pixelAt(session, 2, 2)).toEqual(RED);
    expect(pixelAt(session, 3, 2)).toEqual(BLUE);
  });

  it('keeps the proportions when asked to', () => {
    const session = makeSession();
    paint(session, { x: 2, y: 2, width: 4, height: 2 }, RED);
    session.setSelectionKeepAspectRatio(true);
    session.selectTool('select');
    drag(session, [2, 2], [6, 4]);
    drag(session, [6, 4], [10, 4]);
    expect(selection(session)?.rect).toEqual({ x: 2, y: 2, width: 8, height: 4 });
  });

  it('does not keep the proportions by default', () => {
    const session = makeSession();
    paint(session, { x: 2, y: 2, width: 4, height: 2 }, RED);
    session.selectTool('select');
    drag(session, [2, 2], [6, 4]);
    drag(session, [6, 4], [10, 4]);
    expect(selection(session)?.rect).toEqual({ x: 2, y: 2, width: 8, height: 2 });
  });

  it('keeps the size of the handles constant on screen', () => {
    const grab = (zoom: number): Rect | undefined => {
      const session = makeSession();
      paint(session, { x: 0, y: 0, width: SIZE, height: SIZE }, RED);
      session.setZoom(zoom);
      session.selectTool('select');
      drag(session, [2, 2], [14, 14]);
      // Two pixels from the corner: a handle at 100%, the inside of the selection at 800%.
      drag(session, [4, 4], [6, 4]);
      return selection(session)?.rect;
    };
    expect(grab(100)).toEqual({ x: 4, y: 2, width: 10, height: 12 });
    expect(grab(800)).toEqual({ x: 4, y: 2, width: 12, height: 12 });
  });
});

describe('confirming and cancelling', () => {
  it('does not draw or start a selection with the click that applies the change', () => {
    const session = selectedBlock();
    moveBy(session, 6);
    click(session, 15, 15);
    expect(selection(session)).toBeNull();
    expect(pixelAt(session, 15, 15)).toEqual(TRANSPARENT);
    // The next drag starts a fresh selection.
    drag(session, [8, 2], [12, 6]);
    expect(selection(session)?.rect).toEqual({ x: 8, y: 2, width: 4, height: 4 });
  });

  it('clears the selection on an outside click without a transformation, recording nothing', () => {
    const session = selectedBlock();
    click(session, 15, 15);
    expect(selection(session)).toBeNull();
    expect(session.getSnapshot().canUndo).toBe(false);
    expect(session.getSnapshot().isDirty).toBe(false);
  });

  it('restores the originals on Escape without a history entry, then clears on a second Escape', () => {
    const session = selectedBlock();
    moveBy(session, 6);
    expect(session.runShortcut('tool.cancel')).toBe(true);
    expect(selection(session)).toEqual({ rect: BLOCK, creating: false, pending: false, angle: 0 });
    expect(session.getSelectionPreview()).toBeNull();
    expect(pixelAt(session, 3, 3)).toEqual(RED);
    expect(session.getSnapshot().canUndo).toBe(false);
    expect(session.getSnapshot().isDirty).toBe(false);

    session.runShortcut('tool.cancel');
    expect(selection(session)).toBeNull();
  });

  it('clears the selection on Escape when nothing changed', () => {
    const session = selectedBlock();
    session.runShortcut('tool.cancel');
    expect(selection(session)).toBeNull();
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('answers only to Escape', () => {
    const session = selectedBlock();
    expect(session.runShortcut('tool.finish')).toBe(false);
    expect(session.runShortcut('tool.delete')).toBe(false);
    expect(selection(session)).not.toBeNull();
    session.selectTool('brush');
    expect(session.runShortcut('tool.cancel')).toBe(false);
  });

  it('discards the pending transformation on undo instead of stepping back in the history', () => {
    const session = makeSession();
    paintRed(session);
    session.selectTool('select');
    drag(session, [0, 0], [10, 10]);
    moveBy(session, 3);
    expect(session.getSnapshot().canUndo).toBe(true);
    session.undo();
    expect(session.getSelectionPreview()).toBeNull();
    expect(pixelAt(session, 5, 5)).toEqual(RED);
    session.undo();
    expect(pixelAt(session, 5, 5)).toEqual(TRANSPARENT);
  });
});

describe('never losing artwork', () => {
  it('applies the transformation when another tool is chosen', () => {
    const session = selectedBlock();
    moveBy(session, 6);
    session.selectTool('brush');
    expect(pixelAt(session, 3, 3)).toEqual(TRANSPARENT);
    expect(pixelAt(session, 9, 3)).toEqual(RED);
    session.undo();
    expect(pixelAt(session, 3, 3)).toEqual(RED);
  });

  it('applies the transformation to its own frame when the frame changes', () => {
    const session = selectedBlock();
    moveBy(session, 6);
    session.addFrame();
    expect(pixelAt(session, 9, 3, 0)).toEqual(RED);
    expect(pixelAt(session, 3, 3, 0)).toEqual(TRANSPARENT);
    expect(pixelAt(session, 9, 3, 1)).toEqual(TRANSPARENT);
    expect(selection(session)).toBeNull();
  });

  it('applies the transformation to its own layer when the layer changes', () => {
    const session = makeSession();
    const lower = session.getSnapshot().activeLayer;
    session.addLayer();
    session.selectLayer(lower.id);
    paint(session, BLOCK, RED);
    session.selectTool('select');
    drag(session, [2, 2], [6, 6]);
    moveBy(session, 6);
    session.addLayer();
    expect(getPixel(lower.drawing, 9, 3)).toEqual(RED);
    expect(getPixel(lower.drawing, 3, 3)).toEqual(TRANSPARENT);
  });

  it('counts a pending transformation as an unsaved change', () => {
    const session = selectedBlock();
    moveBy(session, 6);
    expect(session.getSnapshot().isDirty).toBe(true);
  });

  it('saves the result of a pending transformation', () => {
    const session = selectedBlock();
    moveBy(session, 6);
    const { document } = session.createSaveRequest();
    const [frame] = framesFromAnimationDocument(document, SIZE, SIZE);
    const drawing = frame?.layers[0]?.drawing;
    expect(drawing).toBeDefined();
    expect(getPixel(drawing!, 3, 3)).toEqual(TRANSPARENT);
    expect(getPixel(drawing!, 9, 3)).toEqual(RED);
    expect(selection(session)).toBeNull();
  });
});
