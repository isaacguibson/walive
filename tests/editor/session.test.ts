import { describe, expect, it } from 'vitest';
import { framesFromAnimationDocument, toAnimationDocument } from '@editor/animation/serialization';
import { EditorError } from '@editor/errors';
import { renderFrameThumbnail, thumbnailSize } from '@editor/thumbnail';
import { click, makeSession, paintRed, pixelAt, RED, SIZE, TRANSPARENT } from './helpers';

describe('serialization', () => {
  it('turns the animation into a document, leaving blank layers without pixels', () => {
    const session = makeSession();
    paintRed(session);
    session.addLayer();
    const { document } = session.createSaveRequest();
    expect(document.width).toBe(SIZE);
    expect(document.frames).toHaveLength(1);
    const [top, bottom] = document.frames[0]?.layers ?? [];
    expect(top?.pixels).toBeNull();
    expect(bottom?.pixels?.length).toBe(SIZE * SIZE * 4);
  });

  it('restores frames, layers, names, visibility and pixels', () => {
    const session = makeSession();
    paintRed(session);
    session.addLayer();
    session.renameLayer(session.getSnapshot().activeLayer.id, 'Sketch');
    session.setLayerVisible(session.getSnapshot().activeLayer.id, false);
    session.addFrame();

    const { document } = session.createSaveRequest();
    const restored = makeSession({ frames: framesFromAnimationDocument(document, SIZE, SIZE) });
    const snapshot = restored.getSnapshot();
    expect(snapshot.frames).toHaveLength(2);
    expect(snapshot.isDirty).toBe(false);
    expect(snapshot.canUndo).toBe(false);
    const layers = snapshot.frames[0]?.layers ?? [];
    expect(layers.map((layer) => [layer.name, layer.visible])).toEqual([
      ['Sketch', false],
      ['Layer 1', true]
    ]);
    expect(pixelAt(restored, 5, 5, 0, 1)).toEqual(RED);
  });

  it('does not share pixel memory with the document it was loaded from', () => {
    const session = makeSession();
    paintRed(session);
    const { document } = session.createSaveRequest();
    const restored = makeSession({ frames: framesFromAnimationDocument(document, SIZE, SIZE) });
    restored.selectTool('eraser');
    restored.setEraserSize(10);
    click(restored, 5.5, 5.5);
    expect(pixelAt(restored, 5, 5)).toEqual(TRANSPARENT);
    expect(document.frames[0]?.layers[0]?.pixels?.[(5 * SIZE + 5) * 4 + 3]).toBe(255);
  });

  it('rejects documents that do not match the canvas', () => {
    const document = toAnimationDocument(SIZE, SIZE, makeSession().getSnapshot().frames);
    expect(() => framesFromAnimationDocument(document, SIZE + 1, SIZE)).toThrow(EditorError);
    const broken = {
      ...document,
      frames: [{ id: 'f', layers: [{ id: 'l', name: 'x', visible: true, pixels: new Uint8Array(4) }] }]
    };
    expect(() => framesFromAnimationDocument(broken, SIZE, SIZE)).toThrow(EditorError);
  });

  it('keeps selection of the first frame when loading', () => {
    const session = makeSession();
    session.addFrames(2);
    const { document } = session.createSaveRequest();
    const restored = makeSession({ frames: framesFromAnimationDocument(document, SIZE, SIZE) });
    expect(restored.getSnapshot().activeFrame.id).toBe(document.frames[0]?.id);
  });
});

describe('thumbnails', () => {
  it('keeps the aspect ratio within the maximum edge', () => {
    expect(thumbnailSize(1920, 1080, 96)).toEqual({ width: 96, height: 54 });
    expect(thumbnailSize(10, 10, 96)).toEqual({ width: 10, height: 10 });
    expect(thumbnailSize(10_000, 1, 96)).toEqual({ width: 96, height: 1 });
  });

  it('renders the visible composite of the frame', () => {
    const session = makeSession();
    paintRed(session);
    const frame = session.getSnapshot().activeFrame;
    const pixels = renderFrameThumbnail(frame, SIZE, SIZE, SIZE, SIZE);
    expect(Array.from(pixels.slice((5 * SIZE + 5) * 4, (5 * SIZE + 5) * 4 + 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(pixels.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('skips hidden layers', () => {
    const session = makeSession();
    paintRed(session);
    session.setLayerVisible(session.getSnapshot().activeLayer.id, false);
    const pixels = renderFrameThumbnail(session.getSnapshot().activeFrame, SIZE, SIZE, SIZE, SIZE);
    expect(Array.from(pixels.slice((5 * SIZE + 5) * 4, (5 * SIZE + 5) * 4 + 4))).toEqual([0, 0, 0, 0]);
  });
});

describe('shortcut actions in the session', () => {
  it('navigates to the next/previous frame and creates an empty frame at the end', () => {
    const session = makeSession();
    session.addFrames(2);
    const [first, second, third] = session.getSnapshot().frames;
    session.selectFrame(first!.id);

    expect(session.runShortcut('frame.next')).toBe(true);
    expect(session.getSnapshot().activeFrame.id).toBe(second!.id);
    expect(session.getSnapshot().frames).toHaveLength(3);
    expect(session.runShortcut('frame.previous')).toBe(true);
    expect(session.getSnapshot().activeFrame.id).toBe(first!.id);
    expect(session.runShortcut('frame.previous')).toBe(true);
    expect(session.getSnapshot().activeFrame.id).toBe(first!.id);

    session.selectFrame(third!.id);
    expect(session.runShortcut('frame.next')).toBe(true);
    expect(session.getSnapshot().frames).toHaveLength(4);
    const created = session.getSnapshot().activeFrame;
    expect(created).not.toBeNull();
    expect(created.layers.every((layer) => layer.drawing.data === null)).toBe(true);
    expect(session.runShortcut('history.undo')).toBe(true);
    expect(session.getSnapshot().frames).toHaveLength(3);
  });

  it('toggles playback through the shared controller', () => {
    const session = makeSession();
    expect(session.getSnapshot().state.isPlaying).toBe(false);
    expect(session.runShortcut('playback.toggle')).toBe(true);
    expect(session.getSnapshot().state.isPlaying).toBe(true);
    expect(session.runShortcut('playback.toggle')).toBe(true);
    expect(session.getSnapshot().state.isPlaying).toBe(false);
    session.dispose();
  });

  it('runs frame and history actions and ignores the ones it does not own', () => {
    const session = makeSession();
    paintRed(session);
    expect(session.runShortcut('frame.duplicate')).toBe(true);
    expect(session.getSnapshot().frames).toHaveLength(2);
    expect(session.runShortcut('history.undo')).toBe(true);
    expect(session.getSnapshot().frames).toHaveLength(1);
    expect(session.runShortcut('history.redo')).toBe(true);
    expect(session.getSnapshot().frames).toHaveLength(2);
    expect(session.runShortcut('frame.copy')).toBe(true);
    expect(session.getSnapshot().canPaste).toBe(true);
    expect(session.runShortcut('frame.cut')).toBe(true);
    expect(session.getSnapshot().frames).toHaveLength(1);
    expect(session.runShortcut('frame.paste')).toBe(true);
    expect(session.runShortcut('project.save')).toBe(false);
  });
});
