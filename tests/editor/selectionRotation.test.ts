import { describe, expect, it } from 'vitest';
import { framesFromAnimationDocument } from '@editor/animation/serialization';
import { angleOf, normalizeDegrees, rotatePoint } from '@editor/angles';
import { ensureData, getPixel } from '@editor/drawing/raster';
import type { EditorSession } from '@editor/editorSession';
import type { Rect, Rgba } from '@editor/model';
import { rotate } from '@editor/selection/resample';
import { hitTest, resizeRotatedRect } from '@editor/selection/geometry';
import { click, drag, makeSession, pixelAt, RED, TRANSPARENT } from './helpers';

const CANVAS = 32;
const BAR: Rect = { x: 4, y: 7, width: 8, height: 2 };
const CENTER = { x: 8, y: 8 };
const BLUE: Rgba = [0, 0, 255, 255];

function paint(session: EditorSession, rect: Rect, color: Rgba): void {
  const data = ensureData(session.getSnapshot().activeLayer.drawing);
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      data.set(color, (y * CANVAS + x) * 4);
    }
  }
}

/** A red horizontal bar with a blue pixel far away from it, and the bar selected. */
function selectedBar(zoom = 100): EditorSession {
  const session = makeSession({ width: CANVAS, height: CANVAS });
  paint(session, BAR, RED);
  paint(session, { x: 28, y: 28, width: 1, height: 1 }, BLUE);
  session.setZoom(zoom);
  session.selectTool('select');
  drag(session, [4, 7], [12, 9]);
  return session;
}

/** Where the rotation handle is, at the zoom the session has. */
function handleOf(session: EditorSession): [number, number] {
  const { rect } = session.getSnapshot().state.selection!;
  return [rect.x + rect.width / 2, rect.y - 26 / (session.getSnapshot().state.zoom / 100)];
}

/** Drags the rotation handle (wherever the current angle puts it) `degrees` further clockwise around the center. */
function rotateBy(session: EditorSession, degrees: number): void {
  const [x, y] = handleOf(session);
  const angle = selection(session)?.angle ?? 0;
  const from = rotatePoint({ x, y }, angle, CENTER);
  const target = rotatePoint(from, degrees, CENTER);
  drag(session, [from.x, from.y], [target.x, target.y]);
}

const selection = (session: EditorSession) => session.getSnapshot().state.selection;

describe('angles', () => {
  it('turns points clockwise on screen and measures directions the same way', () => {
    const turned = rotatePoint({ x: 10, y: 5 }, 90, { x: 5, y: 5 });
    expect(turned.x).toBeCloseTo(5);
    expect(turned.y).toBeCloseTo(10);
    expect(angleOf({ x: 0, y: 0 }, { x: 0, y: 4 })).toBeCloseTo(90);
    expect(angleOf({ x: 0, y: 0 }, { x: -4, y: 0 })).toBeCloseTo(180);
  });

  it('keeps angles in (-180, 180]', () => {
    expect(normalizeDegrees(270)).toBe(-90);
    expect(normalizeDegrees(-270)).toBe(90);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(720)).toBe(0);
  });
});

describe('rotating pixels', () => {
  const pixels = (width: number, height: number, color: Rgba) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      data.set(color, index * 4);
    }
    return data;
  };

  it('swaps the size on a quarter turn and moves every pixel to where it belongs', () => {
    const source = pixels(4, 2, TRANSPARENT);
    source.set(RED, 0); // top-left
    const result = rotate(source, 4, 2, 90, 'nearest');
    expect([result.width, result.height]).toEqual([2, 4]);
    // The top-left pixel goes to the top-right after a clockwise quarter turn.
    expect(Array.from(result.pixels.slice(4, 8))).toEqual(Array.from(RED));
    expect(result.pixels.filter((value, index) => index % 4 === 3 && value !== 0)).toHaveLength(1);
  });

  it('grows to the bounding box of the turned image with the parity of the source', () => {
    const result = rotate(pixels(8, 2, RED), 8, 2, 45, 'smooth');
    expect(result.width % 2).toBe(0);
    expect(result.height % 2).toBe(0);
    expect(result.width).toBeGreaterThanOrEqual(7);
    expect(result.height).toBeGreaterThanOrEqual(7);
  });

  it('keeps transparent pixels transparent and never tints neighbors', () => {
    const result = rotate(pixels(8, 8, RED), 8, 8, 30, 'smooth');
    const corner = result.pixels.slice(0, 4);
    expect(Array.from(corner)).toEqual([0, 0, 0, 0]);
    for (let index = 0; index < result.pixels.length; index += 4) {
      if (result.pixels[index + 3] !== 0) {
        expect(Array.from(result.pixels.slice(index, index + 3))).toEqual([255, 0, 0]);
      }
    }
  });
});

describe('selection geometry with rotation', () => {
  it('finds the rotation handle above the top edge, also when the selection is turned', () => {
    expect(hitTest(BAR, { x: 8, y: 0.5 }, 2, 0, 6.5)).toEqual({ kind: 'rotate' });
    const turned = rotatePoint({ x: 8, y: 0.5 }, 90, CENTER);
    expect(hitTest(BAR, turned, 2, 90, 6.5)).toEqual({ kind: 'rotate' });
    expect(hitTest(BAR, { x: 8, y: 0.5 }, 2, 90, 6.5).kind).toBe('outside');
  });

  it('does not offer a rotation handle when none is asked for', () => {
    expect(hitTest(BAR, { x: 8, y: 0.5 }, 2).kind).toBe('outside');
  });

  it('hits the body and the corners of a turned rectangle where they appear on the canvas', () => {
    const corner = rotatePoint({ x: BAR.x, y: BAR.y }, 90, CENTER);
    expect(hitTest(BAR, corner, 1, 90, 0)).toEqual({ kind: 'handle', handle: 'nw' });
    expect(hitTest(BAR, { x: 8, y: 5 }, 1, 90, 0).kind).toBe('inside');
    expect(hitTest(BAR, { x: 14, y: 8 }, 1, 90, 0).kind).toBe('outside');
  });

  it('resizes a turned rectangle in its own axes and keeps the opposite side where it was', () => {
    const next = resizeRotatedRect(BAR, 90, 'e', 0, 2, false, CANVAS, CANVAS);
    expect(next).toEqual({ x: 3, y: 8, width: 10, height: 2 });
    const before = rotatePoint({ x: BAR.x, y: BAR.y + BAR.height / 2 }, 90, CENTER);
    const after = rotatePoint({ x: next.x, y: next.y + next.height / 2 }, 90, { x: next.x + next.width / 2, y: next.y + next.height / 2 });
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('is the plain resize when not turned', () => {
    expect(resizeRotatedRect(BAR, 0, 'e', 2, 0, false, CANVAS, CANVAS)).toEqual({ x: 4, y: 7, width: 10, height: 2 });
  });
});

describe('Selection Tool rotation', () => {
  it('shows the selection turned and previews the turned pixels without touching the layer', () => {
    const session = selectedBar();
    rotateBy(session, 90);
    expect(selection(session)).toMatchObject({ rect: BAR, angle: 90, pending: true, creating: false });
    expect(session.getSnapshot().canUndo).toBe(true);
    const preview = session.getSelectionPreview();
    expect(preview?.rect).toEqual({ x: 7, y: 4, width: 2, height: 8 });
    expect(pixelAt(session, 5, 7)).toEqual(RED);
  });

  it('rotates around the center of the selection and applies it as one undo step', () => {
    const session = selectedBar();
    rotateBy(session, 90);
    click(session, 20, 20);
    expect(selection(session)).toBeNull();
    for (const y of [4, 7, 11]) {
      expect(pixelAt(session, 7, y)).toEqual(RED);
      expect(pixelAt(session, 8, y)).toEqual(RED);
    }
    expect(pixelAt(session, 5, 7)).toEqual(TRANSPARENT);
    expect(pixelAt(session, 10, 8)).toEqual(TRANSPARENT);
    expect(pixelAt(session, 28, 28)).toEqual(BLUE);

    session.undo();
    expect(pixelAt(session, 5, 7)).toEqual(RED);
    expect(pixelAt(session, 7, 4)).toEqual(TRANSPARENT);
    expect(pixelAt(session, 28, 28)).toEqual(BLUE);
    session.redo();
    expect(pixelAt(session, 7, 4)).toEqual(RED);
    expect(pixelAt(session, 5, 7)).toEqual(TRANSPARENT);
  });

  it('turns by the same angle at any zoom', () => {
    const apply = (zoom: number) => {
      const session = selectedBar(zoom);
      rotateBy(session, 37);
      click(session, 20, 20);
      return Array.from(session.getSnapshot().activeLayer.drawing.data ?? []);
    };
    expect(apply(400)).toEqual(apply(100));
    expect(apply(25)).toEqual(apply(100));
  });

  it('adds to an angle that was already set', () => {
    const session = selectedBar();
    rotateBy(session, 30);
    rotateBy(session, 30);
    expect(selection(session)?.angle).toBeCloseTo(60, 5);
  });

  it('restores the original on Escape without a history entry, then clears on a second Escape', () => {
    const session = selectedBar();
    rotateBy(session, 90);
    expect(session.runShortcut('tool.cancel')).toBe(true);
    expect(selection(session)).toMatchObject({ rect: BAR, angle: 0, pending: false });
    expect(session.getSelectionPreview()).toBeNull();
    expect(pixelAt(session, 5, 7)).toEqual(RED);
    expect(session.getSnapshot().canUndo).toBe(false);
    session.runShortcut('tool.cancel');
    expect(selection(session)).toBeNull();
  });

  it('does not move or resize while rotating', () => {
    const session = selectedBar();
    rotateBy(session, 45);
    expect(selection(session)?.rect).toEqual(BAR);
  });

  it('still moves and resizes, and a rotated selection keeps its angle while doing so', () => {
    const session = selectedBar();
    rotateBy(session, 90);
    drag(session, [8, 8], [8, 12]);
    expect(selection(session)).toMatchObject({ rect: { x: 4, y: 11, width: 8, height: 2 }, angle: 90 });
    click(session, 28, 4);
    expect(pixelAt(session, 7, 8)).toEqual(RED);
    expect(pixelAt(session, 7, 15)).toEqual(RED);
    expect(pixelAt(session, 5, 11)).toEqual(TRANSPARENT);
  });

  it('keeps the selected content transparent where the image does not reach', () => {
    const session = selectedBar();
    rotateBy(session, 45);
    click(session, 28, 4);
    expect(getPixel(session.getSnapshot().activeLayer.drawing, 8, 8)[3]).toBe(255);
    expect(getPixel(session.getSnapshot().activeLayer.drawing, 4, 4)[3]).toBe(0);
    expect(pixelAt(session, 28, 28)).toEqual(BLUE);
  });

  it('saves and reopens the rotated result', () => {
    const session = selectedBar();
    rotateBy(session, 90);
    const { document } = session.createSaveRequest();
    const restored = makeSession({ width: CANVAS, height: CANVAS, frames: framesFromAnimationDocument(document, CANVAS, CANVAS) });
    expect(Array.from(restored.getSnapshot().activeLayer.drawing.data ?? [])).toEqual(Array.from(session.getSnapshot().activeLayer.drawing.data ?? []));
    expect(pixelAt(restored, 7, 4)).toEqual(RED);
  });

  it('rotates ordinary brush artwork', () => {
    const session = makeSession({ width: CANVAS, height: CANVAS });
    session.setColor('#ff0000');
    session.setBrushSize(2);
    session.pointerDown({ x: 4, y: 8, pointerId: 1, buttons: 1 });
    session.pointerUp({ x: 12, y: 8, pointerId: 1, buttons: 0 });
    session.selectTool('select');
    drag(session, [3, 6], [13, 10]);
    const { rect } = selection(session)!;
    const handle: [number, number] = [rect.x + rect.width / 2, rect.y - 26];
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const target = rotatePoint({ x: handle[0], y: handle[1] }, 90, center);
    drag(session, handle, [target.x, target.y]);
    click(session, 28, 28);
    expect(pixelAt(session, 8, 4)[3]).toBeGreaterThan(0);
    expect(pixelAt(session, 8, 12)[3]).toBeGreaterThan(0);
    expect(pixelAt(session, 4, 8)).toEqual(TRANSPARENT);
  });
});
