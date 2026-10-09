import { describe, expect, it } from 'vitest';
import { framesFromAnimationDocument, toAnimationDocument } from '@editor/animation/serialization';
import { getPixel } from '@editor/drawing/raster';
import { makeSession, SIZE } from './helpers';

function paintAtPressure(session: ReturnType<typeof makeSession>, pointerType: string, pressure: number): void {
  session.setBrushSize(8);
  session.setUsePenPressure(true);
  session.pointerDown({ x: 8.5, y: 8.5, pointerId: 1, pointerType, pressure, buttons: 1 });
  session.pointerUp({ x: 8.5, y: 8.5, pointerId: 1, pointerType, pressure, buttons: 0 });
}

describe('onion reference state', () => {
  it('defaults to hidden with no manual reference and no document changes', () => {
    const session = makeSession();
    expect(session.getSnapshot().onionEnabled).toBe(false);
    expect(session.getSnapshot().manualReferenceFrameId).toBeNull();
    expect(session.getSnapshot().isDirty).toBe(false);
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('toggles visibility independently from the persistent manual designation', () => {
    const session = makeSession();
    session.addFrames(2);
    const [first, second] = session.getSnapshot().frames;
    session.setManualReferenceFrame(first!.id);
    expect(session.getSnapshot().manualReferenceFrameId).toBe(first!.id);
    expect(session.getSnapshot().onionEnabled).toBe(false);
    session.setOnionEnabled(true);
    expect(session.getSnapshot().onionEnabled).toBe(true);
    session.setOnionEnabled(false);
    expect(session.getSnapshot().manualReferenceFrameId).toBe(first!.id);
    expect(session.getSnapshot().onionEnabled).toBe(false);
    session.selectFrame(second!.id);
    expect(session.getSnapshot().manualReferenceFrameId).toBe(first!.id);
  });

  it('allows only one designated frame and makes designation changes undoable', () => {
    const session = makeSession();
    session.addFrames(2);
    const [first, second, third] = session.getSnapshot().frames;
    session.setManualReferenceFrame(first!.id);
    session.setManualReferenceFrame(second!.id);
    expect(session.getSnapshot().manualReferenceFrameId).toBe(second!.id);
    session.undo();
    expect(session.getSnapshot().manualReferenceFrameId).toBe(first!.id);
    session.redo();
    expect(session.getSnapshot().manualReferenceFrameId).toBe(second!.id);
    session.setManualReferenceFrame(third!.id);
    expect(session.getSnapshot().manualReferenceFrameId).toBe(third!.id);
  });

  it('clears a removed designated frame and restores it when removal is undone', () => {
    const session = makeSession();
    session.addFrame();
    const [first, second] = session.getSnapshot().frames;
    session.setManualReferenceFrame(first!.id);
    session.removeFrame(first!.id);
    expect(session.getSnapshot().manualReferenceFrameId).toBeNull();
    session.undo();
    expect(session.getSnapshot().manualReferenceFrameId).toBe(first!.id);
    expect(session.getSnapshot().frames.map((frame) => frame.id)).toContain(first!.id);
    expect(session.getSnapshot().frames.map((frame) => frame.id)).toContain(second!.id);
  });

  it('does not designate a duplicate when duplicating the reference frame', () => {
    const session = makeSession();
    const source = session.getSnapshot().activeFrame;
    session.setManualReferenceFrame(source.id);
    session.duplicateFrame(source.id);
    expect(session.getSnapshot().manualReferenceFrameId).toBe(source.id);
    expect(session.getSnapshot().activeFrame.id).not.toBe(source.id);
  });

  it('keeps the designation attached to its frame through timeline reordering', () => {
    const session = makeSession();
    session.addFrames(2);
    const [first, second, third] = session.getSnapshot().frames;
    session.setManualReferenceFrame(first!.id);
    session.selectFrame(third!.id);

    session.reorderFrame(first!.id, 1);
    expect(session.getSnapshot().frames.map((frame) => frame.id)).toEqual([second!.id, first!.id, third!.id]);
    expect(session.getSnapshot().manualReferenceFrameId).toBe(first!.id);
    expect(session.getSnapshot().activeFrame.id).toBe(third!.id);

    session.undo();
    expect(session.getSnapshot().frames.map((frame) => frame.id)).toEqual([first!.id, second!.id, third!.id]);
    expect(session.getSnapshot().manualReferenceFrameId).toBe(first!.id);
  });

  it('persists the manual reference and remains compatible with old documents', () => {
    const session = makeSession();
    session.addFrame();
    const [first] = session.getSnapshot().frames;
    session.setManualReferenceFrame(first!.id);
    const { document } = session.createSaveRequest();
    expect(document.manualReferenceFrameId).toBe(first!.id);
    const restored = framesFromAnimationDocument(document, SIZE, SIZE);
    const restoredSession = makeSession({ frames: restored, manualReferenceFrameId: document.manualReferenceFrameId });
    expect(restoredSession.getSnapshot().manualReferenceFrameId).toBe(first!.id);

    const oldDocument = toAnimationDocument(SIZE, SIZE, restored);
    expect(oldDocument.manualReferenceFrameId).toBeNull();
    const oldSession = makeSession({ frames: framesFromAnimationDocument(oldDocument, SIZE, SIZE) });
    expect(oldSession.getSnapshot().manualReferenceFrameId).toBeNull();
  });
});

describe('pressure-sensitive brush', () => {
  it('keeps the configured size and toggles pressure without changing the saved size', () => {
    const session = makeSession();
    session.setBrushSize(12);
    session.setUsePenPressure(true);
    expect(session.getSnapshot().state.usePenPressure).toBe(true);
    expect(session.getSnapshot().state.brushSize).toBe(12);
    session.setUsePenPressure(false);
    expect(session.getSnapshot().state.brushSize).toBe(12);
  });

  it('makes high pen pressure produce a wider brush than low pressure', () => {
    const low = makeSession();
    paintAtPressure(low, 'pen', 0.15);
    const high = makeSession();
    paintAtPressure(high, 'pen', 1);

    expect(getPixel(low.getSnapshot().activeLayer.drawing, 10, 8)[3]).toBe(0);
    expect(getPixel(high.getSnapshot().activeLayer.drawing, 10, 8)[3]).toBeGreaterThan(0);
    expect(low.getSnapshot().canUndo).toBe(true);
    expect(high.getSnapshot().canUndo).toBe(true);
  });

  it('falls back to the configured size for mouse, missing, and invalid pressure', () => {
    const mouse = makeSession();
    paintAtPressure(mouse, 'mouse', 0.1);
    const missing = makeSession();
    missing.setBrushSize(8);
    missing.setUsePenPressure(true);
    missing.pointerDown({ x: 8.5, y: 8.5, pointerId: 1, pointerType: 'pen', buttons: 1 });
    missing.pointerUp({ x: 8.5, y: 8.5, pointerId: 1, pointerType: 'pen', buttons: 0 });
    const invalid = makeSession();
    paintAtPressure(invalid, 'pen', 3);

    for (const session of [mouse, missing, invalid]) {
      expect(getPixel(session.getSnapshot().activeLayer.drawing, 10, 8)[3]).toBeGreaterThan(0);
    }
  });

  it('uses a positive minimum at zero pressure and persists the raster result for undo/redo', () => {
    const session = makeSession();
    paintAtPressure(session, 'pen', 0);
    const layer = session.getSnapshot().activeLayer;
    expect(getPixel(layer.drawing, 8, 8)[3]).toBeGreaterThan(0);
    const { document } = session.createSaveRequest();
    const savedPixels = document.frames[0]!.layers[0]!.pixels;
    expect(savedPixels).not.toBeNull();

    session.undo();
    expect(getPixel(session.getSnapshot().activeLayer.drawing, 8, 8)[3]).toBe(0);
    session.redo();
    expect(getPixel(session.getSnapshot().activeLayer.drawing, 8, 8)[3]).toBeGreaterThan(0);
    const reopened = framesFromAnimationDocument(document, SIZE, SIZE);
    expect(getPixel(reopened[0]!.layers[0]!.drawing, 8, 8)[3]).toBeGreaterThan(0);
  });

  it('interpolates brush width along a pressure-changing stroke', () => {
    const session = makeSession();
    session.setBrushSize(8);
    session.setUsePenPressure(true);
    session.pointerDown({ x: 2.5, y: 8.5, pointerId: 1, pointerType: 'pen', pressure: 0.15, buttons: 1 });
    session.pointerMove({ x: 13.5, y: 8.5, pointerId: 1, pointerType: 'pen', pressure: 1, buttons: 1 });
    session.pointerUp({ x: 13.5, y: 8.5, pointerId: 1, pointerType: 'pen', pressure: 1, buttons: 0 });

    expect(getPixel(session.getSnapshot().activeLayer.drawing, 4, 5)[3]).toBe(0);
    expect(getPixel(session.getSnapshot().activeLayer.drawing, 12, 5)[3]).toBeGreaterThan(0);
  });
});
