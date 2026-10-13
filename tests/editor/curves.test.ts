import { describe, expect, it } from 'vitest';
import { framesFromAnimationDocument, toAnimationDocument } from '@editor/animation/serialization';
import { DEFAULT_BRUSH_ID } from '@editor/brushes/registry';
import type { AnchorType, BezierCurve, CurveAnchor } from '@editor/curves/curve';
import {
  appendAnchor,
  canRemoveAnchor,
  cornerAnchor,
  createAnchor,
  insertAnchor,
  isDrawableCurve,
  moveHandle,
  removeAnchor,
  smoothAnchor
} from '@editor/curves/editing';
import { distance, flattenAnchors, nearestOnPath, pathLength, segmentOf, splitSegment } from '@editor/curves/geometry';
import { compositePixel } from '@editor/drawing/raster';
import type { EditorSession } from '@editor/editorSession';
import { CURVE_LIMITS } from '@shared/types/curves';
import { click, drag, makeSession, SIZE } from './helpers';

const NO_HANDLE = { x: 0, y: 0 };

function anchor(x: number, y: number, type: AnchorType = 'corner', handleIn = NO_HANDLE, handleOut = NO_HANDLE): CurveAnchor {
  return { x, y, type, handleIn, handleOut };
}

function curveOf(...anchors: CurveAnchor[]): BezierCurve {
  return { id: 'c', anchors, style: { brush: DEFAULT_BRUSH_ID, settings: {}, color: '#ff0000', size: 2, opacity: 100, seed: 1 } };
}

function curveSession(): EditorSession {
  const session = makeSession();
  // Zoomed in, so the on-screen hit areas of anchors and handles are small on this tiny canvas.
  session.setZoom(400);
  session.selectTool('bezier');
  session.setColor('#ff0000');
  session.setCurveSize(2);
  session.setCurveOpacity(100);
  return session;
}

const curvesOf = (session: EditorSession): readonly BezierCurve[] => session.getSnapshot().activeLayer.curves;
const editorOf = (session: EditorSession) => session.getSnapshot().state.curveEditor;
const pixel = (session: EditorSession, x: number, y: number) => compositePixel([session.getSnapshot().activeLayer], x, y);

/** Clicks the points and finishes the path. */
function draw(session: EditorSession, points: [number, number][]): void {
  for (const [x, y] of points) {
    click(session, x, y);
  }
  session.finishCurve();
}

/** A straight horizontal curve from (2, 8) to (14, 8). */
function drawLine(session: EditorSession): void {
  draw(session, [
    [2, 8],
    [14, 8]
  ]);
}

describe('curve geometry', () => {
  it('flattens a straight segment to its ends', () => {
    const points = flattenAnchors([anchor(0, 0), anchor(10, 0)]);
    expect(points).toHaveLength(2);
    expect(pathLength(points)).toBeCloseTo(10);
  });

  it('flattens a curved segment into a longer polyline within the tolerance', () => {
    const anchors = [anchor(0, 0, 'smooth', NO_HANDLE, { x: 0, y: 8 }), anchor(10, 0, 'smooth', { x: 0, y: 8 }, NO_HANDLE)];
    const points = flattenAnchors(anchors);
    expect(points.length).toBeGreaterThan(4);
    expect(pathLength(points)).toBeGreaterThan(10);
    const peak = Math.max(...points.map((point) => point.y));
    expect(peak).toBeCloseTo(6, 0);
  });

  it('splits a segment into two halves that meet on the curve', () => {
    const segment = segmentOf(anchor(0, 0, 'smooth', NO_HANDLE, { x: 4, y: 4 }), anchor(8, 0, 'smooth', { x: -4, y: 4 }, NO_HANDLE));
    const [left, right] = splitSegment(segment, 0.5);
    expect(left[3]).toEqual(right[0]);
    expect(left[3].x).toBeCloseTo(4);
    expect(left[3].y).toBeCloseTo(3);
  });

  it('finds the nearest point of a path only within the distance', () => {
    const anchors = [anchor(0, 0), anchor(10, 0)];
    const hit = nearestOnPath(anchors, { x: 4, y: 2 }, 3);
    expect(hit?.point).toEqual({ x: 4, y: 0 });
    expect(hit?.t).toBeCloseTo(0.4);
    expect(hit?.distance).toBeCloseTo(2);
    expect(nearestOnPath(anchors, { x: 4, y: 5 }, 3)).toBeNull();
  });
});

describe('curve editing', () => {
  it('creates corner anchors without handles and keeps coordinates in range', () => {
    expect(createAnchor({ x: 3, y: 4 })).toEqual(anchor(3, 4));
    expect(createAnchor({ x: Number.MAX_VALUE, y: -Number.MAX_VALUE })).toMatchObject({
      x: CURVE_LIMITS.maxCoordinate,
      y: -CURVE_LIMITS.maxCoordinate
    });
  });

  it('needs two distinct anchors to be drawable', () => {
    expect(isDrawableCurve(curveOf(anchor(1, 1)))).toBe(false);
    expect(isDrawableCurve(curveOf(anchor(1, 1), anchor(1, 1)))).toBe(false);
    expect(isDrawableCurve(appendAnchor(curveOf(anchor(1, 1)), anchor(5, 1)))).toBe(true);
  });

  it('moves the opposite handle of a smooth anchor and keeps its length', () => {
    const curve = curveOf(anchor(0, 0), anchor(10, 0, 'smooth', { x: -3, y: 0 }, { x: 3, y: 0 }));
    const moved = moveHandle(curve, 1, 'out', { x: 10, y: 5 });
    const { handleIn, handleOut } = moved.anchors[1] as CurveAnchor;
    expect(handleOut).toEqual({ x: 0, y: 5 });
    expect(handleIn.x).toBeCloseTo(0);
    expect(handleIn.y).toBeCloseTo(-3);
  });

  it('moves the handles of a corner anchor independently', () => {
    const curve = curveOf(anchor(0, 0), anchor(10, 0, 'corner', { x: -3, y: 0 }, { x: 3, y: 0 }));
    const moved = moveHandle(curve, 1, 'out', { x: 10, y: 5 });
    expect(moved.anchors[1]).toMatchObject({ handleIn: { x: -3, y: 0 }, handleOut: { x: 0, y: 5 } });
  });

  it('smooths an anchor along its neighbors and turns it back into a corner', () => {
    const curve = curveOf(anchor(0, 0), anchor(5, 5), anchor(10, 0));
    const smooth = smoothAnchor(curve, 1).anchors[1] as CurveAnchor;
    expect(smooth.type).toBe('smooth');
    expect(smooth.handleOut.x).toBeGreaterThan(0);
    expect(smooth.handleOut.y).toBeCloseTo(0);
    expect(smooth.handleIn.x).toBeCloseTo(-smooth.handleOut.x);
    expect(cornerAnchor(smoothAnchor(curve, 1), 1).anchors[1]).toMatchObject({ type: 'corner', handleOut: smooth.handleOut });
  });

  it('inserts an anchor without changing the shape of the path', () => {
    const curve = curveOf(anchor(0, 0, 'smooth', NO_HANDLE, { x: 0, y: 8 }), anchor(10, 0, 'smooth', { x: 0, y: 8 }, NO_HANDLE));
    const result = insertAnchor(curve, 0, 0.5);
    expect(result?.index).toBe(1);
    expect(result?.curve.anchors).toHaveLength(3);
    const before = flattenAnchors(curve.anchors, 0.01);
    const after = flattenAnchors(result?.curve.anchors ?? [], 0.01);
    for (const point of after) {
      expect(nearestOnPath(curve.anchors, point, 0.5)).not.toBeNull();
    }
    expect(pathLength(after)).toBeCloseTo(pathLength(before), 1);
  });

  it('refuses to insert an anchor on top of a neighbor', () => {
    expect(insertAnchor(curveOf(anchor(0, 0), anchor(10, 0)), 0, 0.01)).toBeNull();
  });

  it('removes anchors only while two remain', () => {
    const three = curveOf(anchor(0, 0), anchor(5, 5), anchor(10, 0));
    expect(canRemoveAnchor(three)).toBe(true);
    const two = removeAnchor(three, 1);
    expect(two?.anchors).toHaveLength(2);
    expect(two !== null && canRemoveAnchor(two)).toBe(false);
    expect(two !== null && removeAnchor(two, 0)).toBeNull();
    expect(distance(two?.anchors[0] ?? NO_HANDLE, { x: 0, y: 0 })).toBe(0);
  });
});

describe('Bézier tool', () => {
  it('shows a draft while drawing and creates the curve when finished', () => {
    const session = curveSession();
    click(session, 2, 8);
    click(session, 14, 8);
    expect(editorOf(session).draft?.anchors).toHaveLength(2);
    expect(curvesOf(session)).toHaveLength(0);

    expect(session.runShortcut('tool.finish')).toBe(true);
    expect(editorOf(session).draft).toBeNull();
    expect(curvesOf(session)).toHaveLength(1);
    expect(editorOf(session).selectedCurveId).toBe(curvesOf(session)[0]?.id);
  });

  it('renders the curve with the chosen color and no pixels away from it', () => {
    const session = curveSession();
    drawLine(session);
    const on = pixel(session, 8, 8);
    expect(on?.[0]).toBe(255);
    expect(on?.[1]).toBe(0);
    expect(on?.[3]).toBeGreaterThan(0);
    expect(pixel(session, 8, 3)).toBeNull();
    expect(pixel(session, 8, 13)).toBeNull();
  });

  it('keeps the curve out of the layer pixels', () => {
    const session = curveSession();
    drawLine(session);
    expect(session.getSnapshot().activeLayer.drawing.data).toBeNull();
  });

  it('shapes a new anchor by dragging its handles', () => {
    const session = curveSession();
    click(session, 2, 8);
    drag(session, [8, 8], [12, 4]);
    session.finishCurve();
    const second = curvesOf(session)[0]?.anchors[1] as CurveAnchor;
    expect(second.type).toBe('smooth');
    expect(second.handleOut).toEqual({ x: 4, y: -4 });
    expect(second.handleIn).toEqual({ x: -4, y: 4 });
  });

  it('discards a path with a single anchor or with the Escape action', () => {
    const session = curveSession();
    click(session, 2, 8);
    session.finishCurve();
    expect(curvesOf(session)).toHaveLength(0);
    expect(editorOf(session).draft).toBeNull();

    click(session, 2, 8);
    click(session, 14, 8);
    expect(session.runShortcut('tool.cancel')).toBe(true);
    expect(curvesOf(session)).toHaveLength(0);
    expect(editorOf(session).draft).toBeNull();
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('finishes the draft with a double-click without adding an extra anchor', () => {
    const session = curveSession();
    click(session, 2, 8);
    click(session, 14, 8);
    click(session, 14, 8);
    session.doubleClick({ x: 14, y: 8, pointerId: 1, buttons: 0 });
    expect(curvesOf(session)[0]?.anchors).toHaveLength(2);
  });

  it('removes the last anchor of a draft with the Delete action', () => {
    const session = curveSession();
    click(session, 2, 8);
    click(session, 8, 8);
    click(session, 14, 8);
    session.runShortcut('tool.delete');
    expect(editorOf(session).draft?.anchors).toHaveLength(2);
  });

  it('ignores curve shortcuts when another tool is selected', () => {
    const session = curveSession();
    session.selectTool('brush');
    expect(session.runShortcut('tool.finish')).toBe(false);
    expect(session.runShortcut('tool.delete')).toBe(false);
  });

  it('selects a curve by clicking it and starts a new one on empty canvas', () => {
    const session = curveSession();
    drawLine(session);
    session.cancelCurve();
    expect(editorOf(session).selectedCurveId).toBeNull();

    click(session, 8, 8);
    expect(editorOf(session).selectedCurveId).toBe(curvesOf(session)[0]?.id);
    expect(session.getSnapshot().canUndo).toBe(true);
    session.undo();
    expect(curvesOf(session)).toHaveLength(0);

    drawLine(session);
    click(session, 8, 2);
    expect(editorOf(session).draft).not.toBeNull();
    expect(editorOf(session).selectedCurveId).toBeNull();
  });

  it('moves a whole curve as a single undo step', () => {
    const session = curveSession();
    drawLine(session);
    drag(session, [8, 8], [8, 11]);
    const moved = curvesOf(session)[0]?.anchors as readonly CurveAnchor[];
    expect(moved.map((item) => item.y)).toEqual([11, 11]);
    expect(pixel(session, 8, 11)).not.toBeNull();
    expect(pixel(session, 8, 8)).toBeNull();

    session.undo();
    expect(curvesOf(session)[0]?.anchors.map((item) => item.y)).toEqual([8, 8]);
    expect(pixel(session, 8, 8)).not.toBeNull();
    session.redo();
    expect(curvesOf(session)[0]?.anchors.map((item) => item.y)).toEqual([11, 11]);
  });

  it('does not create history for a click that does not move anything', () => {
    const session = curveSession();
    drawLine(session);
    session.undo();
    session.redo();
    click(session, 8, 8);
    session.undo();
    expect(curvesOf(session)).toHaveLength(0);
  });

  it('moves a single anchor', () => {
    const session = curveSession();
    drawLine(session);
    drag(session, [2, 8], [2, 12]);
    expect(curvesOf(session)[0]?.anchors.map((item) => [item.x, item.y])).toEqual([
      [2, 12],
      [14, 8]
    ]);
    expect(editorOf(session).selectedAnchor).toBe(0);
  });

  it('drags a handle and keeps a smooth anchor aligned', () => {
    const session = curveSession();
    click(session, 2, 8);
    drag(session, [8, 8], [12, 4]);
    session.finishCurve();
    drag(session, [12, 4], [12, 2]);
    const { handleIn, handleOut } = curvesOf(session)[0]?.anchors[1] as CurveAnchor;
    expect(handleOut).toEqual({ x: 4, y: -6 });
    expect(handleIn.x * handleOut.y - handleIn.y * handleOut.x).toBeCloseTo(0);
    session.undo();
    expect(curvesOf(session)[0]?.anchors[1]?.handleOut).toEqual({ x: 4, y: -4 });
  });

  it('adds an anchor with a double-click on the path', () => {
    const session = curveSession();
    drawLine(session);
    session.doubleClick({ x: 8, y: 8, pointerId: 1, buttons: 0 });
    const anchors = curvesOf(session)[0]?.anchors as readonly CurveAnchor[];
    expect(anchors).toHaveLength(3);
    expect(anchors[1]?.x).toBeCloseTo(8);
    expect(editorOf(session).selectedAnchor).toBe(1);
    session.undo();
    expect(curvesOf(session)[0]?.anchors).toHaveLength(2);
  });

  it('toggles an anchor between smooth and corner with a double-click', () => {
    const session = curveSession();
    click(session, 2, 8);
    drag(session, [8, 8], [12, 4]);
    session.finishCurve();
    session.doubleClick({ x: 8, y: 8, pointerId: 1, buttons: 0 });
    expect(curvesOf(session)[0]?.anchors[1]?.type).toBe('corner');
    session.doubleClick({ x: 8, y: 8, pointerId: 1, buttons: 0 });
    expect(curvesOf(session)[0]?.anchors[1]?.type).toBe('smooth');
  });

  it('changes the anchor type from the options panel actions', () => {
    const session = curveSession();
    draw(session, [
      [2, 8],
      [8, 4],
      [14, 8]
    ]);
    click(session, 8, 4);
    session.setSelectedAnchorType('smooth');
    expect(curvesOf(session)[0]?.anchors[1]?.type).toBe('smooth');
    session.setSelectedAnchorType('corner');
    expect(curvesOf(session)[0]?.anchors[1]?.type).toBe('corner');
  });

  it('removes the selected anchor, then the whole curve when only two remain', () => {
    const session = curveSession();
    draw(session, [
      [2, 8],
      [8, 4],
      [14, 8]
    ]);
    click(session, 8, 4);
    expect(editorOf(session).selectedAnchor).toBe(1);
    session.runShortcut('tool.delete');
    expect(curvesOf(session)[0]?.anchors).toHaveLength(2);
    session.runShortcut('tool.delete');
    expect(curvesOf(session)).toHaveLength(0);
    session.undo();
    expect(curvesOf(session)).toHaveLength(1);
  });

  it('deletes the selected curve', () => {
    const session = curveSession();
    drawLine(session);
    session.deleteSelectedCurve();
    expect(curvesOf(session)).toHaveLength(0);
    expect(pixel(session, 8, 8)).toBeNull();
  });

  it('uses the options at creation and changes them only when applied', () => {
    const session = curveSession();
    drawLine(session);
    session.setCurveSize(6);
    session.setCurveOpacity(40);
    expect(curvesOf(session)[0]?.style).toMatchObject({ size: 2, opacity: 100 });

    session.applyCurveStyle();
    expect(curvesOf(session)[0]?.style).toMatchObject({ size: 6, opacity: 40 });
    session.undo();
    expect(curvesOf(session)[0]?.style).toMatchObject({ size: 2, opacity: 100 });
  });

  it('keeps the options of the Bézier tool separate from the Brush tool', () => {
    const session = curveSession();
    session.setBrushSize(30);
    expect(session.getSnapshot().state.curveBrush.size).toBe(2);
    expect(session.getSnapshot().state.brushSize).toBe(30);
  });

  it('commits the draft when the tool changes', () => {
    const session = curveSession();
    click(session, 2, 8);
    click(session, 14, 8);
    session.selectTool('brush');
    expect(editorOf(session).draft).toBeNull();
    expect(curvesOf(session)).toHaveLength(1);
  });

  it('commits the draft on the original frame when the frame changes', () => {
    const session = curveSession();
    click(session, 2, 8);
    click(session, 14, 8);
    session.addFrame();
    expect(session.getSnapshot().frames[0]?.layers[0]?.curves).toHaveLength(1);
    expect(curvesOf(session)).toHaveLength(0);
  });

  it('discards a draft with undo without touching the history', () => {
    const session = curveSession();
    drawLine(session);
    click(session, 2, 2);
    click(session, 14, 2);
    session.undo();
    expect(editorOf(session).draft).toBeNull();
    expect(curvesOf(session)).toHaveLength(1);
  });

  it('refuses to draw on a hidden layer', () => {
    const session = curveSession();
    session.setLayerVisible(session.getSnapshot().activeLayer.id, false);
    click(session, 2, 8);
    expect(editorOf(session).draft).toBeNull();
    expect(session.getSnapshot().error).toMatch(/hidden/i);
  });

  it('keeps the curves of each layer separate', () => {
    const session = curveSession();
    drawLine(session);
    session.addLayer();
    draw(session, [
      [2, 3],
      [14, 3]
    ]);
    const counts = session.getSnapshot().activeFrame.layers.map((layer) => layer.curves.length);
    expect(counts).toEqual([1, 1]);
    expect(curvesOf(session)[0]?.anchors[0]?.y).toBe(3);
  });

  it('gives a duplicated frame its own curves', () => {
    const session = curveSession();
    drawLine(session);
    session.duplicateFrame();
    const [first, second] = session.getSnapshot().frames;
    session.selectFrame(second?.id ?? '');
    drag(session, [8, 8], [8, 11]);
    expect(session.getSnapshot().frames[1]?.layers[0]?.curves[0]?.anchors[0]?.y).toBe(11);
    expect(session.getSnapshot().frames[0]?.layers[0]?.curves[0]?.anchors[0]?.y).toBe(8);
    expect(first?.layers[0]?.curves[0]?.anchors[0]?.y).toBe(8);
  });

  it('clears the curves with the frame', () => {
    const session = curveSession();
    drawLine(session);
    session.clearFrame();
    expect(curvesOf(session)).toHaveLength(0);
    expect(pixel(session, 8, 8)).toBeNull();
    session.undo();
    expect(curvesOf(session)).toHaveLength(1);
  });
});

describe('curve serialization', () => {
  it('round-trips curves through the stored document', () => {
    const session = curveSession();
    click(session, 2, 8);
    drag(session, [8, 8], [12, 4]);
    session.finishCurve();
    const { document } = session.createSaveRequest();

    const restored = makeSession({ frames: framesFromAnimationDocument(document, SIZE, SIZE) });
    expect(restored.getSnapshot().activeLayer.curves).toEqual(curvesOf(session));
    expect(pixel(restored, 5, 8)).toEqual(pixel(session, 5, 8));
  });

  it('does not store curves for layers that have none', () => {
    const document = toAnimationDocument(SIZE, SIZE, makeSession().getSnapshot().frames);
    expect(document.frames[0]?.layers[0]).not.toHaveProperty('curves');
  });

  it('drops stored curves that cannot be drawn and falls back to the default brush', () => {
    const session = curveSession();
    drawLine(session);
    const [curve] = curvesOf(session) as [BezierCurve];
    const document = session.createSaveRequest().document;
    const layer = document.frames[0]?.layers[0];
    const broken = {
      ...document,
      frames: [
        {
          ...document.frames[0],
          layers: [
            {
              ...layer,
              curves: [
                { ...curve, id: 'dot', anchors: [anchor(4, 4), anchor(4, 4)] },
                { ...curve, id: 'unknown-brush', style: { ...curve.style, brush: 'does-not-exist' } }
              ]
            }
          ]
        }
      ]
    };
    const frames = framesFromAnimationDocument(broken as typeof document, SIZE, SIZE);
    const restored = frames[0]?.layers[0]?.curves ?? [];
    expect(restored.map((item) => item.id)).toEqual(['unknown-brush']);
    expect(restored[0]?.style.brush).toBe(DEFAULT_BRUSH_ID);
  });
});
