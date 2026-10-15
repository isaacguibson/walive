import { describe, expect, it } from 'vitest';
import { framesFromAnimationDocument } from '@editor/animation/serialization';
import { distance } from '@editor/curves/geometry';
import { getPixel } from '@editor/drawing/raster';
import type { EditorSession } from '@editor/editorSession';
import type { DrawingData } from '@editor/model';
import { isInEditingArea, lineEnds, shapeOutline, type Shape } from '@editor/shapes/geometry';
import { click, drag, makeSession } from './helpers';

const CANVAS = 64;
const CENTER = { x: 32, y: 32 };

function shapeSession(): EditorSession {
  const session = makeSession({ width: CANVAS, height: CANVAS });
  session.selectTool('shape');
  session.setColor('#ff0000');
  session.setShapeOpacity(100);
  return session;
}

const pending = (session: EditorSession) => session.getSnapshot().state.shapeEditor.pending;
const layerPixels = (session: EditorSession) => session.getSnapshot().activeLayer.drawing;
const alphaAt = (session: EditorSession, x: number, y: number) => getPixel(layerPixels(session), x, y)[3];
const filledArea = (drawing: DrawingData) => {
  let total = 0;
  for (let index = 3; index < (drawing.data?.length ?? 0); index += 4) {
    total += (drawing.data?.[index] ?? 0) / 255;
  }
  return total;
};

function shape(overrides: Partial<Shape>): Shape {
  return { kind: 'square', size: 20, rotation: 0, strokeWidth: 2, fill: false, opacity: 100, center: CENTER, color: '#ff0000', ...overrides };
}

describe('shape geometry', () => {
  it('draws a square with equal sides around its center', () => {
    const corners = shapeOutline(shape({ kind: 'square', size: 20 }));
    expect(corners).toEqual([
      { x: 22, y: 22 },
      { x: 42, y: 22 },
      { x: 42, y: 42 },
      { x: 22, y: 42 }
    ]);
  });

  it('turns clockwise around the center', () => {
    const [first] = shapeOutline(shape({ kind: 'square', size: 20, rotation: 90 }));
    expect(first?.x).toBeCloseTo(42);
    expect(first?.y).toBeCloseTo(22);
  });

  it('draws an equilateral triangle with the given side, pointing up', () => {
    const [top, right, left] = shapeOutline(shape({ kind: 'triangle', size: 30 }));
    expect(distance(top!, right!)).toBeCloseTo(30);
    expect(distance(right!, left!)).toBeCloseTo(30);
    expect(distance(left!, top!)).toBeCloseTo(30);
    expect(top?.x).toBeCloseTo(32);
    expect(top!.y).toBeLessThan(32);
  });

  it('draws a circle whose points are all at the radius', () => {
    for (const point of shapeOutline(shape({ kind: 'circle', size: 30 }))) {
      expect(distance(point, CENTER)).toBeCloseTo(15);
    }
  });

  it('draws a line of the given length centered on its midpoint, at any rotation', () => {
    const [from, to] = shapeOutline(shape({ kind: 'line', size: 40, rotation: 90 }));
    expect(distance(from!, to!)).toBeCloseTo(40);
    expect((from!.x + to!.x) / 2).toBeCloseTo(32);
    expect((from!.y + to!.y) / 2).toBeCloseTo(32);
    expect(from!.x).toBeCloseTo(32);
    expect(to!.y).toBeCloseTo(52);
  });

  it('has an editing area that contains the shape plus a tolerance', () => {
    const square = shape({ kind: 'square', size: 20, strokeWidth: 2 });
    expect(isInEditingArea(square, { x: 42, y: 42 }, 0)).toBe(true);
    expect(isInEditingArea(square, { x: 60, y: 60 }, 0)).toBe(false);
    expect(isInEditingArea(square, { x: 50, y: 32 }, 0)).toBe(false);
    expect(isInEditingArea(square, { x: 50, y: 32 }, 3)).toBe(true);
  });
});

describe('Geometric Shapes tool', () => {
  it('is selectable and starts with a square, outlined, rotation 0', () => {
    const session = shapeSession();
    expect(session.getSnapshot().state.selectedTool).toBe('shape');
    expect(session.getSnapshot().state.shape).toMatchObject({ kind: 'square', rotation: 0, fill: false });
  });

  it('places a pending shape on the first press, without touching the layer', () => {
    const session = shapeSession();
    click(session, 32, 32);
    expect(pending(session)).toMatchObject({ kind: 'square', center: CENTER, size: 100 });
    expect(layerPixels(session).data).toBeNull();
    expect(session.getSnapshot().canUndo).toBe(true);
    expect(session.getSnapshot().isDirty).toBe(true);
    expect(session.getPendingPreview()?.drawing).toBeDefined();
  });

  it('moves the pending shape when it is dragged and keeps one pending shape', () => {
    const session = shapeSession();
    session.setShapeSize(20);
    click(session, 32, 32);
    drag(session, [32, 32], [40, 36]);
    expect(pending(session)?.center).toEqual({ x: 40, y: 36 });
    drag(session, [30, 30], [30, 30]);
    expect(pending(session)?.center).toEqual({ x: 40, y: 36 });
  });

  it('sizes the shape by dragging from the first press to where it should end', () => {
    const session = shapeSession();
    drag(session, [10, 10], [30, 24]);
    expect(pending(session)).toMatchObject({ kind: 'square', size: 20, center: { x: 20, y: 20 } });
    expect(session.getSnapshot().state.shape.size).toBe(20);
    expect(layerPixels(session).data).toBeNull();

    session.cancelShape();
    drag(session, [40, 40], [30, 20]);
    expect(pending(session)).toMatchObject({ size: 20, center: { x: 30, y: 30 } });
  });

  it('shows the shape growing while the pointer is still down', () => {
    const session = shapeSession();
    session.pointerDown({ x: 10, y: 10, pointerId: 1, buttons: 1 });
    expect(pending(session)).toBeNull();
    session.pointerMove({ x: 20, y: 20, pointerId: 1, buttons: 1 });
    expect(pending(session)?.size).toBe(10);
    session.pointerMove({ x: 40, y: 30, pointerId: 1, buttons: 1 });
    expect(pending(session)?.size).toBe(30);
    session.pointerUp({ x: 40, y: 30, pointerId: 1, buttons: 0 });
    expect(pending(session)).toMatchObject({ size: 30, center: { x: 25, y: 25 } });
  });

  it('runs a line from the press to the pointer, taking its length and angle from the drag', () => {
    const session = shapeSession();
    session.setShapeKind('line');
    drag(session, [10, 10], [10, 30]);
    expect(pending(session)).toMatchObject({ kind: 'line', size: 20, rotation: 90, center: { x: 10, y: 20 } });
    expect(session.getSnapshot().state.shape).toMatchObject({ size: 20, rotation: 90 });
    session.finishShape();
    expect(alphaAt(session, 10, 12)).toBeGreaterThan(0);
    expect(alphaAt(session, 10, 28)).toBeGreaterThan(0);
    expect(alphaAt(session, 20, 20)).toBe(0);
  });

  it('ends a line exactly where the pointer is released, at any length', () => {
    const session = shapeSession();
    session.setShapeKind('line');
    drag(session, [10, 10], [13, 14]);
    const [start, end] = lineEnds(pending(session)!);
    expect(start.x).toBeCloseTo(10);
    expect(start.y).toBeCloseTo(10);
    expect(end.x).toBeCloseTo(13);
    expect(end.y).toBeCloseTo(14);
    expect(pending(session)?.size).toBeCloseTo(5);

    session.cancelShape();
    drag(session, [10, 10], [1510, 10]);
    expect(pending(session)?.size).toBe(1500);
    expect(lineEnds(pending(session)!)[1].x).toBeCloseTo(1510);
  });

  it('moves one end of a pending line by dragging it, keeping the other end in place', () => {
    const session = shapeSession();
    session.setShapeKind('line');
    drag(session, [10, 10], [40, 10]);
    drag(session, [40, 10], [40, 40]);
    const ends = lineEnds(pending(session)!);
    const fixed = ends.find((point) => Math.abs(point.x - 10) < 1e-9 && Math.abs(point.y - 10) < 1e-9);
    const moved = ends.find((point) => Math.abs(point.x - 40) < 1e-9 && Math.abs(point.y - 40) < 1e-9);
    expect(fixed).toBeDefined();
    expect(moved).toBeDefined();
    expect(pending(session)?.size).toBeCloseTo(Math.hypot(30, 30));
    expect(session.getSnapshot().state.shape.size).toBeCloseTo(Math.hypot(30, 30));

    drag(session, [10, 10], [5, 50]);
    expect(lineEnds(pending(session)!).some((point) => Math.abs(point.x - 5) < 1e-9 && Math.abs(point.y - 50) < 1e-9)).toBe(true);
    expect(layerPixels(session).data).toBeNull();
  });

  it('moves a pending line by dragging its body, and confirms with a press beside it', () => {
    const session = shapeSession();
    session.setShapeKind('line');
    session.setShapeStrokeWidth(2);
    drag(session, [10, 10], [50, 10]);
    drag(session, [30, 10], [30, 20]);
    const [start, end] = lineEnds(pending(session)!);
    expect([start.y, end.y].map((y) => Math.round(y))).toEqual([20, 20]);

    // Inside the circle around the line but away from it: this confirms instead of moving.
    click(session, 30, 35);
    expect(pending(session)).toBeNull();
    expect(alphaAt(session, 30, 20)).toBeGreaterThan(0);
    expect(alphaAt(session, 30, 35)).toBe(0);
  });

  it('keeps the size slider and a drag in step: the pending shape can be resized afterwards', () => {
    const session = shapeSession();
    session.setShapeKind('circle');
    drag(session, [10, 10], [30, 30]);
    session.setShapeSize(40);
    expect(pending(session)).toMatchObject({ kind: 'circle', size: 40, center: { x: 20, y: 20 } });
  });

  it('places the shape centered on a click that does not drag, with the size of the options', () => {
    const session = shapeSession();
    session.setShapeSize(30);
    click(session, 20, 20);
    expect(pending(session)).toMatchObject({ size: 30, center: { x: 20, y: 20 } });
  });

  it('follows size, rotation, type and style changes while pending, keeping its position', () => {
    const session = shapeSession();
    session.setShapeSize(20);
    click(session, 32, 32);
    session.setShapeSize(40);
    session.setShapeRotation(30);
    session.setShapeKind('triangle');
    session.setShapeFill(true);
    session.setShapeStrokeWidth(5);
    session.setShapeOpacity(50);
    session.setColor('#0000ff');
    expect(pending(session)).toMatchObject({ kind: 'triangle', size: 40, rotation: 30, fill: true, strokeWidth: 5, opacity: 50, color: '#0000ff', center: CENTER });
    expect(layerPixels(session).data).toBeNull();
  });

  it('validates the options', () => {
    const session = shapeSession();
    expect(session.setShapeSize('abc')).toBe(false);
    expect(session.setShapeSize('')).toBe(false);
    expect(session.setShapeRotation(Number.NaN)).toBe(false);
    expect(session.setShapeKind('hexagon' as never)).toBe(false);
    session.setShapeSize(5000);
    expect(session.getSnapshot().state.shape.size).toBe(1000);
    session.setShapeSize(0);
    expect(session.getSnapshot().state.shape.size).toBe(1);
    session.setShapeRotation(270);
    expect(session.getSnapshot().state.shape.rotation).toBe(-90);
    session.setShapeRotation('45.25');
    expect(session.getSnapshot().state.shape.rotation).toBe(45.3);
  });

  it('confirms with Enter exactly once, as one undo step of ordinary pixels', () => {
    const session = shapeSession();
    session.setShapeSize(20);
    session.setShapeFill(true);
    click(session, 32, 32);
    expect(session.runShortcut('tool.finish')).toBe(true);
    session.runShortcut('tool.finish');
    session.finishShape();
    expect(pending(session)).toBeNull();
    expect(getPixel(layerPixels(session), 32, 32)).toEqual([255, 0, 0, 255]);

    session.undo();
    expect(layerPixels(session).data?.some((value) => value !== 0)).toBe(false);
    expect(session.getSnapshot().canUndo).toBe(false);
    session.redo();
    expect(alphaAt(session, 32, 32)).toBe(255);
  });

  it('confirms with a press outside and does not start a second shape', () => {
    const session = shapeSession();
    session.setShapeSize(20);
    session.setShapeFill(true);
    click(session, 32, 32);
    click(session, 5, 5);
    expect(pending(session)).toBeNull();
    expect(alphaAt(session, 32, 32)).toBe(255);
    expect(alphaAt(session, 5, 5)).toBe(0);
    session.undo();
    expect(session.getSnapshot().canUndo).toBe(false);
    expect(alphaAt(session, 32, 32)).toBe(0);
  });

  it('discards with Escape without modifying the project', () => {
    const session = shapeSession();
    click(session, 32, 32);
    expect(session.runShortcut('tool.cancel')).toBe(true);
    expect(pending(session)).toBeNull();
    expect(session.getPendingPreview()).toBeNull();
    expect(layerPixels(session).data).toBeNull();
    expect(session.getSnapshot().canUndo).toBe(false);
    expect(session.getSnapshot().isDirty).toBe(false);
  });

  it('discards a pending shape with Undo, like a pending curve', () => {
    const session = shapeSession();
    click(session, 32, 32);
    session.undo();
    expect(pending(session)).toBeNull();
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('never silently commits or discards: leaving the tool, the frame or the layer is refused', () => {
    const session = shapeSession();
    session.setShapeSize(20);
    click(session, 32, 32);
    session.selectTool('brush');
    expect(session.getSnapshot().state.selectedTool).toBe('shape');
    expect(session.getSnapshot().error).toMatch(/pending shape/i);
    const frames = session.getSnapshot().frames.length;
    session.addFrame();
    session.addLayer();
    session.selectFrame(session.getSnapshot().activeFrame.id);
    session.togglePlayback();
    expect(session.getSnapshot().frames.length).toBe(frames);
    expect(session.getSnapshot().activeFrame.layers).toHaveLength(1);
    expect(session.getSnapshot().state.isPlaying).toBe(false);
    expect(pending(session)).not.toBeNull();
    expect(layerPixels(session).data).toBeNull();

    session.finishShape();
    session.selectTool('brush');
    expect(session.getSnapshot().state.selectedTool).toBe('brush');
  });

  it('saves only what was confirmed and keeps the pending shape out of the document', () => {
    const session = shapeSession();
    session.setShapeSize(20);
    click(session, 32, 32);
    const request = session.createSaveRequest();
    expect(request.document.frames[0]?.layers[0]?.pixels).toBeNull();
    expect(pending(session)).not.toBeNull();
    expect(session.getSnapshot().isDirty).toBe(true);

    session.finishShape();
    const { document } = session.createSaveRequest();
    const restored = makeSession({ width: CANVAS, height: CANVAS, frames: framesFromAnimationDocument(document, CANVAS, CANVAS) });
    expect(Array.from(restored.getSnapshot().activeLayer.drawing.data ?? [])).toEqual(Array.from(layerPixels(session).data ?? []));
  });

  it('refuses to hide the layer while a shape is pending', () => {
    const session = shapeSession();
    session.setShapeSize(20);
    click(session, 32, 32);
    session.setLayerVisible(session.getSnapshot().activeLayer.id, false);
    expect(session.getSnapshot().activeLayer.visible).toBe(true);
    expect(session.getSnapshot().error).toMatch(/pending shape/i);
    expect(pending(session)).not.toBeNull();
  });
});

describe('shape rendering', () => {
  const confirmed = (options: (session: EditorSession) => void, at: [number, number] = [32, 32]) => {
    const session = shapeSession();
    options(session);
    click(session, at[0], at[1]);
    session.finishShape();
    return session;
  };

  it('outlines a square and leaves its inside empty', () => {
    const session = confirmed((s) => {
      s.setShapeSize(20);
      s.setShapeStrokeWidth(2);
    });
    expect(alphaAt(session, 32, 22)).toBeGreaterThan(0);
    expect(alphaAt(session, 22, 32)).toBeGreaterThan(0);
    expect(alphaAt(session, 32, 32)).toBe(0);
    expect(alphaAt(session, 32, 12)).toBe(0);
  });

  it('fills shapes with the right area and proportions', () => {
    const square = confirmed((s) => {
      s.setShapeSize(20);
      s.setShapeFill(true);
    });
    expect(filledArea(layerPixels(square))).toBeCloseTo(400, 0);

    const turned = confirmed((s) => {
      s.setShapeSize(20);
      s.setShapeFill(true);
      s.setShapeRotation(45);
    });
    expect(filledArea(layerPixels(turned))).toBeGreaterThan(396);
    expect(filledArea(layerPixels(turned))).toBeLessThan(404);

    const circle = confirmed((s) => {
      s.setShapeKind('circle');
      s.setShapeSize(30);
      s.setShapeFill(true);
    });
    expect(filledArea(layerPixels(circle))).toBeGreaterThan(Math.PI * 225 * 0.99);
    expect(filledArea(layerPixels(circle))).toBeLessThan(Math.PI * 225 * 1.01);

    const triangle = confirmed((s) => {
      s.setShapeKind('triangle');
      s.setShapeSize(30);
      s.setShapeFill(true);
    });
    expect(filledArea(layerPixels(triangle))).toBeGreaterThan((Math.sqrt(3) / 4) * 900 * 0.99);
    expect(filledArea(layerPixels(triangle))).toBeLessThan((Math.sqrt(3) / 4) * 900 * 1.01);
  });

  it('draws a straight line of the chosen length, width and angle', () => {
    const horizontal = confirmed((s) => {
      s.setShapeKind('line');
      s.setShapeSize(30);
      s.setShapeStrokeWidth(4);
    });
    expect(alphaAt(horizontal, 18, 32)).toBe(255);
    expect(alphaAt(horizontal, 46, 32)).toBe(255);
    expect(alphaAt(horizontal, 32, 36)).toBe(0);
    expect(alphaAt(horizontal, 10, 32)).toBe(0);

    const vertical = confirmed((s) => {
      s.setShapeKind('line');
      s.setShapeSize(30);
      s.setShapeStrokeWidth(4);
      s.setShapeRotation(90);
    });
    expect(alphaAt(vertical, 32, 18)).toBe(255);
    expect(alphaAt(vertical, 32, 46)).toBe(255);
    expect(alphaAt(vertical, 36, 32)).toBe(0);
  });

  it('honors the opacity', () => {
    const session = confirmed((s) => {
      s.setShapeSize(20);
      s.setShapeFill(true);
      s.setShapeOpacity(50);
    });
    expect(alphaAt(session, 32, 32)).toBe(128);
  });

  it('gives the same pixels at any canvas zoom', () => {
    const at = (zoom: number) => {
      const session = shapeSession();
      session.setZoom(zoom);
      session.setShapeKind('triangle');
      session.setShapeSize(24);
      session.setShapeRotation(20);
      click(session, 30.5, 33.25);
      session.finishShape();
      return Array.from(layerPixels(session).data ?? []);
    };
    expect(at(400)).toEqual(at(100));
    expect(at(25)).toEqual(at(100));
  });

  it('keeps shapes off the canvas clipped and still draws the part that is inside', () => {
    const session = confirmed((s) => {
      s.setShapeSize(40);
      s.setShapeFill(true);
    }, [2, 2]);
    expect(alphaAt(session, 0, 0)).toBe(255);
    expect(alphaAt(session, 30, 30)).toBe(0);
  });

  it('paints ordinary pixels that the Selection Tool can move', () => {
    const session = confirmed((s) => {
      s.setShapeSize(10);
      s.setShapeFill(true);
    });
    session.selectTool('select');
    drag(session, [20, 20], [44, 44]);
    drag(session, [32, 32], [32, 52]);
    click(session, 2, 2);
    expect(alphaAt(session, 32, 32)).toBe(0);
    expect(alphaAt(session, 32, 52)).toBe(255);
  });
});
