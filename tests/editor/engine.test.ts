import { describe, expect, it } from 'vitest';
import { FrameClipboardStore } from '@editor/animation/clipboard';
import { MAX_ADD_FRAMES } from '@editor/constants';
import { isDrawingBlank } from '@editor/drawing/raster';
import { click, makeSession, paintRed, pixelAt, RED, TRANSPARENT } from './helpers';

function frameCount(session: ReturnType<typeof makeSession>): number {
  return session.getSnapshot().frames.length;
}

describe('initial state', () => {
  it('starts with one blank frame with one layer, selected', () => {
    const session = makeSession();
    const snapshot = session.getSnapshot();
    expect(snapshot.frames).toHaveLength(1);
    expect(snapshot.activeFrame.layers).toHaveLength(1);
    expect(snapshot.activeLayer.name).toBe('Layer 1');
    expect(isDrawingBlank(snapshot.activeLayer.drawing)).toBe(true);
    expect(snapshot.isDirty).toBe(false);
    expect(snapshot.canUndo).toBe(false);
    expect(snapshot.state.fps).toBe(24);
    expect(snapshot.state.zoom).toBe(100);
    expect(snapshot.state.loopPlayback).toBe(true);
    expect(snapshot.state.selectedTool).toBe('brush');
  });

  it('refuses unsupported canvas sizes', () => {
    expect(() => makeSession({ width: 0, height: 10 })).toThrow();
    expect(() => makeSession({ width: 20_000, height: 10 })).toThrow();
  });
});

describe('adding frames', () => {
  it('adds one blank frame after the active frame and selects it', () => {
    const session = makeSession();
    session.addFrame();
    session.selectFrame(session.getSnapshot().frames[0]?.id ?? '');
    session.addFrame();
    const snapshot = session.getSnapshot();
    expect(snapshot.frames).toHaveLength(3);
    expect(snapshot.activeFrame.id).toBe(snapshot.frames[1]?.id);
  });

  it('adds several frames at once and selects the last one', () => {
    const session = makeSession();
    expect(session.addFrames(5)).toBe(true);
    const snapshot = session.getSnapshot();
    expect(snapshot.frames).toHaveLength(6);
    expect(snapshot.activeFrame.id).toBe(snapshot.frames[5]?.id);
    session.undo();
    expect(frameCount(session)).toBe(1);
  });

  it('rejects invalid quantities with an error and no change', () => {
    const session = makeSession();
    for (const count of [0, -1, 1.5, Number.NaN, MAX_ADD_FRAMES + 1]) {
      expect(session.addFrames(count), String(count)).toBe(false);
      expect(session.getSnapshot().error).not.toBeNull();
    }
    expect(frameCount(session)).toBe(1);
    expect(session.getSnapshot().isDirty).toBe(false);
  });

  it('gives every new frame its own layer and ids', () => {
    const session = makeSession();
    session.addFrames(3);
    const ids = session.getSnapshot().frames.flatMap((frame) => [frame.id, ...frame.layers.map((layer) => layer.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('duplicating, clearing and removing frames', () => {
  it('duplicates a frame right after it with independent pixels', () => {
    const session = makeSession();
    paintRed(session);
    session.duplicateFrame();
    expect(frameCount(session)).toBe(2);
    expect(session.getSnapshot().activeFrame.id).toBe(session.getSnapshot().frames[1]?.id);
    expect(pixelAt(session, 5, 5, 1)).toEqual(RED);
    session.selectTool('eraser');
    session.setEraserSize(10);
    click(session, 5.5, 5.5);
    expect(pixelAt(session, 5, 5, 1)).toEqual(TRANSPARENT);
    expect(pixelAt(session, 5, 5, 0)).toEqual(RED);
  });

  it('clears all layers of a frame but keeps the frame and its layers', () => {
    const session = makeSession();
    paintRed(session);
    session.addLayer();
    session.clearFrame();
    const frame = session.getSnapshot().activeFrame;
    expect(frame.layers).toHaveLength(2);
    expect(frame.layers.every((layer) => isDrawingBlank(layer.drawing))).toBe(true);
    session.undo();
    expect(pixelAt(session, 5, 5, undefined, 1)).toEqual(RED);
  });

  it('removes a frame and selects its neighbor', () => {
    const session = makeSession();
    session.addFrames(2);
    const [first, second, third] = session.getSnapshot().frames;
    session.selectFrame(second?.id ?? '');
    session.removeFrame();
    const snapshot = session.getSnapshot();
    expect(snapshot.frames.map((frame) => frame.id)).toEqual([first?.id, third?.id]);
    expect(snapshot.activeFrame.id).toBe(third?.id);
  });

  it('selects the previous frame when the last one is removed', () => {
    const session = makeSession();
    session.addFrame();
    const [first] = session.getSnapshot().frames;
    session.removeFrame();
    expect(session.getSnapshot().activeFrame.id).toBe(first?.id);
  });

  it('keeps an animation with a blank frame when the only frame is removed', () => {
    const session = makeSession();
    paintRed(session);
    const originalId = session.getSnapshot().activeFrame.id;
    session.removeFrame();
    const snapshot = session.getSnapshot();
    expect(snapshot.frames).toHaveLength(1);
    expect(snapshot.activeFrame.id).not.toBe(originalId);
    expect(isDrawingBlank(snapshot.activeLayer.drawing)).toBe(true);
    session.undo();
    expect(pixelAt(session, 5, 5)).toEqual(RED);
  });

  it('can remove a frame that is not the selected one without changing the selection', () => {
    const session = makeSession();
    session.addFrames(2);
    const [first, , third] = session.getSnapshot().frames;
    session.removeFrame(first?.id);
    expect(session.getSnapshot().activeFrame.id).toBe(third?.id);
    expect(frameCount(session)).toBe(2);
  });
});

describe('frame clipboard', () => {
  it('copy leaves the animation unchanged and enables paste', () => {
    const session = makeSession();
    paintRed(session);
    const before = session.getSnapshot();
    expect(before.canPaste).toBe(false);
    session.copyFrame();
    expect(session.getSnapshot().canPaste).toBe(true);
    expect(frameCount(session)).toBe(1);
    expect(session.getSnapshot().frames).toBe(before.frames);
  });

  it('paste replaces the content of the target frame without creating frames', () => {
    const session = makeSession();
    paintRed(session);
    session.copyFrame();
    session.addFrame();
    session.pasteFrame();
    expect(frameCount(session)).toBe(2);
    expect(pixelAt(session, 5, 5, 1)).toEqual(RED);
    const frames = session.getSnapshot().frames;
    expect(frames[1]?.id).not.toBe(frames[0]?.id);
    expect(frames[1]?.layers[0]?.id).not.toBe(frames[0]?.layers[0]?.id);
  });

  it('pasted content is independent from the original and can be pasted repeatedly', () => {
    const session = makeSession();
    paintRed(session);
    session.copyFrame();
    session.addFrames(2);
    session.pasteFrame();
    session.selectTool('eraser');
    session.setEraserSize(10);
    click(session, 5.5, 5.5);
    expect(pixelAt(session, 5, 5, 0)).toEqual(RED);
    session.selectFrame(session.getSnapshot().frames[1]?.id ?? '');
    session.pasteFrame();
    expect(pixelAt(session, 5, 5, 1)).toEqual(RED);
  });

  it('cut removes the frame and keeps it for pasting', () => {
    const session = makeSession();
    session.addFrame();
    paintRed(session);
    session.cutFrame();
    expect(frameCount(session)).toBe(1);
    session.pasteFrame();
    expect(pixelAt(session, 5, 5)).toEqual(RED);
    expect(frameCount(session)).toBe(1);
  });

  it('paste without clipboard content does nothing', () => {
    const session = makeSession();
    session.pasteFrame();
    expect(session.getSnapshot().canUndo).toBe(false);
    expect(session.getSnapshot().error).toBeNull();
  });

  it('the clipboard is shared between sessions of the application', () => {
    const clipboard = new FrameClipboardStore();
    const first = makeSession({ clipboard });
    paintRed(first);
    first.copyFrame();
    const second = makeSession({ clipboard });
    expect(second.getSnapshot().canPaste).toBe(true);
    second.pasteFrame();
    expect(pixelAt(second, 5, 5)).toEqual(RED);
  });

  it('refuses to paste a frame with a different canvas size', () => {
    const clipboard = new FrameClipboardStore();
    const large = makeSession({ clipboard, width: 32, height: 32 });
    large.copyFrame();
    const small = makeSession({ clipboard });
    small.pasteFrame();
    expect(small.getSnapshot().error).toMatch(/canvas size/i);
    expect(small.getSnapshot().canUndo).toBe(false);
  });

  it('notifies subscribers when the clipboard changes', () => {
    const session = makeSession();
    let notifications = 0;
    const unsubscribe = session.subscribe(() => {
      notifications += 1;
    });
    session.copyFrame();
    expect(notifications).toBeGreaterThan(0);
    unsubscribe();
  });
});

describe('layers', () => {
  it('adds a layer above the active one and selects it', () => {
    const session = makeSession();
    session.addLayer();
    const frame = session.getSnapshot().activeFrame;
    expect(frame.layers.map((layer) => layer.name)).toEqual(['Layer 2', 'Layer 1']);
    expect(session.getSnapshot().activeLayer.id).toBe(frame.layers[0]?.id);
  });

  it('keeps layers independent per frame', () => {
    const session = makeSession();
    session.addLayer();
    session.addFrame();
    expect(session.getSnapshot().activeFrame.layers).toHaveLength(1);
    expect(session.getSnapshot().frames[0]?.layers).toHaveLength(2);
  });

  it('renames with validation', () => {
    const session = makeSession();
    const id = session.getSnapshot().activeLayer.id;
    expect(session.renameLayer(id, '  Background  ')).toBe(true);
    expect(session.getSnapshot().activeLayer.name).toBe('Background');
    expect(session.renameLayer(id, '   ')).toBe(false);
    expect(session.renameLayer(id, 'x'.repeat(51))).toBe(false);
    expect(session.getSnapshot().activeLayer.name).toBe('Background');
  });

  it('toggles visibility', () => {
    const session = makeSession();
    const id = session.getSnapshot().activeLayer.id;
    session.setLayerVisible(id, false);
    expect(session.getSnapshot().activeLayer.visible).toBe(false);
    session.setLayerVisible(id, true);
    expect(session.getSnapshot().activeLayer.visible).toBe(true);
  });

  it('reorders layers and the stacking order follows', () => {
    const session = makeSession();
    session.addLayer();
    const [top, bottom] = session.getSnapshot().activeFrame.layers;
    session.moveLayer(top?.id ?? '', 'down');
    expect(session.getSnapshot().activeFrame.layers.map((layer) => layer.id)).toEqual([bottom?.id, top?.id]);
    session.moveLayer(top?.id ?? '', 'down');
    expect(session.getSnapshot().activeFrame.layers.map((layer) => layer.id)).toEqual([bottom?.id, top?.id]);
    session.moveLayer(top?.id ?? '', 'up');
    expect(session.getSnapshot().activeFrame.layers.map((layer) => layer.id)).toEqual([top?.id, bottom?.id]);
  });

  it('removes layers but never the last one', () => {
    const session = makeSession();
    session.addLayer();
    const [top, bottom] = session.getSnapshot().activeFrame.layers;
    session.removeLayer(top?.id ?? '');
    expect(session.getSnapshot().activeFrame.layers.map((layer) => layer.id)).toEqual([bottom?.id]);
    expect(session.getSnapshot().activeLayer.id).toBe(bottom?.id);
    session.removeLayer(bottom?.id ?? '');
    expect(session.getSnapshot().activeFrame.layers).toHaveLength(1);
    expect(session.getSnapshot().error).toMatch(/at least one layer/i);
  });

  it('selects layers', () => {
    const session = makeSession();
    session.addLayer();
    const [, bottom] = session.getSnapshot().activeFrame.layers;
    session.selectLayer(bottom?.id ?? '');
    expect(session.getSnapshot().activeLayer.id).toBe(bottom?.id);
  });
});

describe('central undo history', () => {
  it('undoes and redoes drawing, layer and frame operations in order', () => {
    const session = makeSession();
    paintRed(session);
    session.addLayer();
    session.addFrame();
    expect(session.getSnapshot().frames).toHaveLength(2);

    session.undo();
    expect(session.getSnapshot().frames).toHaveLength(1);
    expect(session.getSnapshot().activeFrame.layers).toHaveLength(2);
    session.undo();
    expect(session.getSnapshot().activeFrame.layers).toHaveLength(1);
    session.undo();
    expect(pixelAt(session, 5, 5)).toEqual(TRANSPARENT);
    expect(session.getSnapshot().canUndo).toBe(false);

    session.redo();
    expect(pixelAt(session, 5, 5)).toEqual(RED);
    session.redo();
    session.redo();
    expect(session.getSnapshot().frames).toHaveLength(2);
    expect(session.getSnapshot().canRedo).toBe(false);
  });

  it('a new action discards the redo stack', () => {
    const session = makeSession();
    session.addFrame();
    session.undo();
    expect(session.getSnapshot().canRedo).toBe(true);
    session.addLayer();
    expect(session.getSnapshot().canRedo).toBe(false);
  });

  it('selecting frames or layers is not recorded', () => {
    const session = makeSession();
    session.addFrame();
    session.selectFrame(session.getSnapshot().frames[0]?.id ?? '');
    session.undo();
    expect(session.getSnapshot().frames).toHaveLength(1);
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('shows the frame affected by an undone stroke', () => {
    const session = makeSession();
    session.addFrame();
    paintRed(session);
    session.selectFrame(session.getSnapshot().frames[0]?.id ?? '');
    session.undo();
    expect(session.getSnapshot().activeFrame.id).toBe(session.getSnapshot().frames[1]?.id);
    expect(pixelAt(session, 5, 5)).toEqual(TRANSPARENT);
  });

  it('keeps a bounded number of entries', () => {
    const session = makeSession();
    for (let index = 0; index < 150; index += 1) {
      session.addLayer();
    }
    let undone = 0;
    while (session.getSnapshot().canUndo) {
      session.undo();
      undone += 1;
    }
    expect(undone).toBe(100);
  });
});

describe('dirty state', () => {
  it('becomes dirty after a change and clean after saving that exact state', () => {
    const session = makeSession();
    expect(session.getSnapshot().isDirty).toBe(false);
    paintRed(session);
    expect(session.getSnapshot().isDirty).toBe(true);
    const { token } = session.createSaveRequest();
    session.markSaved(token);
    expect(session.getSnapshot().isDirty).toBe(false);
  });

  it('is dirty again when undoing past the saved state, clean when returning to it', () => {
    const session = makeSession();
    paintRed(session);
    session.markSaved(session.createSaveRequest().token);
    session.undo();
    expect(session.getSnapshot().isDirty).toBe(true);
    session.redo();
    expect(session.getSnapshot().isDirty).toBe(false);
  });

  it('stays dirty when something changes while a save is in flight', () => {
    const session = makeSession();
    paintRed(session);
    const { token } = session.createSaveRequest();
    session.addFrame();
    session.markSaved(token);
    expect(session.getSnapshot().isDirty).toBe(true);
  });

  it('selection, zoom, tool and playback settings do not make the project dirty', () => {
    const session = makeSession();
    session.selectTool('eraser');
    session.setZoom('200');
    session.setFps('30');
    session.setLoop(false);
    session.setColor('#abcdef');
    session.copyFrame();
    expect(session.getSnapshot().isDirty).toBe(false);
  });
});

describe('snapshots', () => {
  it('are stable until something changes', () => {
    const session = makeSession();
    expect(session.getSnapshot()).toBe(session.getSnapshot());
    const before = session.getSnapshot();
    session.addFrame();
    expect(session.getSnapshot()).not.toBe(before);
  });

  it('notify subscribers of changes', () => {
    const session = makeSession();
    let calls = 0;
    const unsubscribe = session.subscribe(() => {
      calls += 1;
    });
    session.addFrame();
    session.setZoom('150');
    unsubscribe();
    session.addFrame();
    expect(calls).toBe(2);
  });
});
