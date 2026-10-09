import { describe, expect, it } from 'vitest';
import { getPixel, isDrawingBlank } from '@editor/drawing/raster';
import { click, drag, makeSession, paintRed, pixelAt, RED, SIZE, TRANSPARENT } from './helpers';

describe('brush', () => {
  it('paints with the selected color and size on the active layer', () => {
    const session = makeSession();
    paintRed(session);
    expect(pixelAt(session, 5, 5)).toEqual(RED);
    expect(pixelAt(session, 0, 0)).toEqual(TRANSPARENT);
  });

  it('draws continuous strokes between pointer positions', () => {
    const session = makeSession();
    session.setColor('#ff0000');
    session.setBrushSize(2);
    drag(session, [2.5, 8.5], [12.5, 8.5]);
    for (let x = 2; x <= 12; x += 1) {
      expect(pixelAt(session, x, 8), `x=${x}`).toEqual(RED);
    }
  });

  it('only paints inside the canvas and ignores strokes entirely outside', () => {
    const session = makeSession();
    session.setBrushSize(4);
    click(session, -50, -50);
    expect(session.getSnapshot().canUndo).toBe(false);
    click(session, 0, 0);
    expect(session.getSnapshot().canUndo).toBe(true);
  });

  it('paints only the active layer', () => {
    const session = makeSession();
    session.addLayer();
    paintRed(session);
    expect(pixelAt(session, 5, 5, undefined, 0)).toEqual(RED);
    expect(pixelAt(session, 5, 5, undefined, 1)).toEqual(TRANSPARENT);
  });

  it('paints only the active frame', () => {
    const session = makeSession();
    session.addFrame();
    paintRed(session);
    expect(pixelAt(session, 5, 5, 1)).toEqual(RED);
    expect(pixelAt(session, 5, 5, 0)).toEqual(TRANSPARENT);
  });

  it('refuses to draw on a hidden layer and reports why', () => {
    const session = makeSession();
    session.setLayerVisible(session.getSnapshot().activeLayer.id, false);
    paintRed(session);
    expect(session.getSnapshot().error).toMatch(/hidden/i);
    expect(isDrawingBlank(session.getSnapshot().activeLayer.drawing)).toBe(true);
  });

  it('ends the gesture when the button was released outside the canvas', () => {
    const session = makeSession();
    session.setBrushSize(2);
    session.pointerDown({ x: 2.5, y: 2.5, pointerId: 1, buttons: 1 });
    session.pointerMove({ x: 4.5, y: 2.5, pointerId: 1, buttons: 0 });
    expect(session.isDrawing).toBe(false);
    session.pointerMove({ x: 9.5, y: 2.5, pointerId: 1, buttons: 1 });
    expect(pixelAt(session, 9, 2)).toEqual(TRANSPARENT);
  });

  it('ignores events of other pointers while one gesture is active', () => {
    const session = makeSession();
    session.pointerDown({ x: 1, y: 1, pointerId: 1, buttons: 1 });
    session.pointerDown({ x: 8, y: 8, pointerId: 2, buttons: 1 });
    session.pointerUp({ x: 8, y: 8, pointerId: 2, buttons: 0 });
    expect(session.isDrawing).toBe(true);
    session.pointerCancel(1);
    expect(session.isDrawing).toBe(false);
  });
});

describe('eraser', () => {
  it('removes pixels of the active layer only', () => {
    const session = makeSession();
    paintRed(session);
    session.addLayer();
    session.selectTool('brush');
    click(session, 5.5, 5.5);
    session.selectTool('eraser');
    session.setEraserSize(8);
    click(session, 5.5, 5.5);
    expect(pixelAt(session, 5, 5, undefined, 0)).toEqual(TRANSPARENT);
    expect(pixelAt(session, 5, 5, undefined, 1)).toEqual(RED);
  });

  it('does nothing on an empty layer', () => {
    const session = makeSession();
    session.selectTool('eraser');
    click(session, 5.5, 5.5);
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('is undoable', () => {
    const session = makeSession();
    paintRed(session);
    session.selectTool('eraser');
    session.setEraserSize(8);
    click(session, 5.5, 5.5);
    session.undo();
    expect(pixelAt(session, 5, 5)).toEqual(RED);
  });
});

describe('fill tool', () => {
  it('fills the contiguous area of the active layer with the active color', () => {
    const session = makeSession();
    session.selectTool('fill');
    session.setColor('#00ff00');
    click(session, 3, 3);
    expect(pixelAt(session, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(session, SIZE - 1, SIZE - 1)).toEqual([0, 255, 0, 255]);
  });

  it('stops at pixels of a different color', () => {
    const session = makeSession();
    session.setColor('#ff0000');
    session.setBrushSize(1);
    drag(session, [8.5, 0.5], [8.5, 15.5]);
    session.selectTool('fill');
    session.setColor('#0000ff');
    click(session, 1, 1);
    expect(pixelAt(session, 3, 9)).toEqual([0, 0, 255, 255]);
    expect(pixelAt(session, 8, 9)).toEqual(RED);
    expect(pixelAt(session, 12, 9)).toEqual(TRANSPARENT);
  });

  it('does not touch other layers and is undoable', () => {
    const session = makeSession();
    session.addLayer();
    session.selectTool('fill');
    click(session, 2, 2);
    expect(pixelAt(session, 2, 2, undefined, 1)).toEqual(TRANSPARENT);
    session.undo();
    expect(pixelAt(session, 2, 2, undefined, 0)).toEqual(TRANSPARENT);
  });

  it('does not record anything when the area already has the fill color', () => {
    const session = makeSession();
    session.selectTool('fill');
    click(session, 2, 2);
    session.undo();
    session.redo();
    click(session, 2, 2);
    expect(session.getSnapshot().canRedo).toBe(false);
    session.undo();
    expect(session.getSnapshot().canUndo).toBe(false);
  });
});

describe('color picker', () => {
  it('uses the visible color under the pointer as the active color', () => {
    const session = makeSession();
    paintRed(session);
    session.setColor('#123456');
    session.selectTool('eyedropper');
    click(session, 5.5, 5.5);
    expect(session.getSnapshot().state.color).toBe('#ff0000');
  });

  it('keeps the current color over transparent or outside areas', () => {
    const session = makeSession();
    session.setColor('#123456');
    session.selectTool('eyedropper');
    click(session, 1, 1);
    click(session, -5, 40);
    expect(session.getSnapshot().state.color).toBe('#123456');
  });

  it('does not modify the drawing', () => {
    const session = makeSession();
    paintRed(session);
    session.selectTool('eyedropper');
    click(session, 5.5, 5.5);
    expect(getPixel(session.getSnapshot().activeLayer.drawing, 5, 5)).toEqual(RED);
    expect(session.engine.history.canUndo).toBe(true);
    session.undo();
    expect(session.getSnapshot().canUndo).toBe(false);
  });
});

describe('selection tool', () => {
  it('selects a rectangle clamped to the canvas', () => {
    const session = makeSession();
    session.selectTool('selection');
    drag(session, [2, 3], [10, 9]);
    expect(session.getSnapshot().state.selection).toEqual({ x: 2, y: 3, width: 8, height: 6 });
    drag(session, [10, 9], [100, 100]);
    expect(session.getSnapshot().state.selection).toEqual({ x: 10, y: 9, width: SIZE - 10, height: SIZE - 9 });
  });

  it('clears the previous selection when a new gesture starts without area', () => {
    const session = makeSession();
    session.selectTool('selection');
    drag(session, [2, 3], [10, 9]);
    click(session, 4, 4);
    expect(session.getSnapshot().state.selection).toBeNull();
  });

  it('does not change pixels or the history', () => {
    const session = makeSession();
    session.selectTool('selection');
    drag(session, [2, 3], [10, 9]);
    expect(session.getSnapshot().canUndo).toBe(false);
    expect(session.getSnapshot().isDirty).toBe(false);
  });
});

describe('tool selection', () => {
  it('has Brush selected by default and switches tools', () => {
    const session = makeSession();
    expect(session.getSnapshot().state.selectedTool).toBe('brush');
    for (const tool of ['eraser', 'fill', 'eyedropper', 'selection', 'brush'] as const) {
      session.selectTool(tool);
      expect(session.getSnapshot().state.selectedTool).toBe(tool);
    }
  });

  it('cannot change tool in the middle of a gesture', () => {
    const session = makeSession();
    session.pointerDown({ x: 1, y: 1, pointerId: 1, buttons: 1 });
    session.selectTool('eraser');
    expect(session.getSnapshot().state.selectedTool).toBe('brush');
  });
});
