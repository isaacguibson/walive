import { describe, expect, it } from 'vitest';
import { getPixel, isDrawingBlank } from '@editor/drawing/raster';
import { EditorSession } from '@editor/editorSession';
import { ToolExecutionError } from '@shared/ai/tools';
import { createEditorToolHost } from '../../src/renderer/ai/editorToolHost';
import { describeRendering, renderFrame } from '../../src/renderer/ai/framePreview';
import { createMockAssetsApi, createMockScenesApi, fail } from './helpers';

const SIZE = 32;

function setup(assets = createMockAssetsApi()) {
  const session = new EditorSession({ width: SIZE, height: SIZE });
  const scenes = createMockScenesApi(['Intro']);
  const host = createEditorToolHost({ session, projectName: 'Studio', scene: { id: 'scene-1', name: 'Intro' }, scenesApi: scenes, assetsApi: assets });
  const pixel = (x: number, y: number) => getPixel(session.getSnapshot().activeLayer.drawing, x, y);
  return { session, host, scenes, assets, pixel };
}

const RED = '#ff0000';
const line = (color = RED, size = 4) => ({ points: [[4, 8], [20, 8]] as [number, number][], color, size, opacity: 100 });

describe('project inspection', () => {
  it('describes the project, scene, frames and layers', async () => {
    const { host, session } = setup();
    session.addFrame();
    const info = host.getProjectInfo();
    expect(info).toMatchObject({ projectName: 'Studio', canvas: { width: SIZE, height: SIZE }, fps: 24, scene: { id: 'scene-1', name: 'Intro' }, frameCount: 2 });
    expect(info.activeFrameId).toBe(session.getSnapshot().activeFrame.id);
    expect(host.listFrames().map((frame) => [frame.index, frame.active])).toEqual([[0, false], [1, true]]);
    expect(host.listLayers(null)).toEqual([expect.objectContaining({ name: 'Layer 1', visible: true, hasArtwork: false, curveCount: 0, active: true })]);
    expect(await host.listScenes()).toEqual({ activeSceneId: 'scene-1', scenes: [{ id: 'scene-1', name: 'Intro' }] });
  });

  it('lists assets and reports failures as tool errors', async () => {
    const { host, assets } = setup();
    expect(await host.listAssets()).toEqual([]);
    assets.listAssets.mockResolvedValueOnce(fail('No project is open.'));
    await expect(host.listAssets()).rejects.toThrow(new ToolExecutionError('No project is open.'));
  });

  it('refuses ids that do not exist', () => {
    const { host } = setup();
    expect(() => host.listLayers('nope')).toThrow(ToolExecutionError);
    expect(() => host.selectFrame('nope')).toThrow(ToolExecutionError);
    expect(() => host.renameLayer('nope', 'x')).toThrow(ToolExecutionError);
  });
});

describe('drawing', () => {
  it('draws strokes through the editor, one undo step per stroke', () => {
    const { host, session, pixel } = setup();
    expect(host.drawStrokes([line(), { ...line('#0000ff'), points: [[4, 20], [20, 20]] }], null, false)).toBe(2);
    expect(pixel(10, 8)).toEqual([255, 0, 0, 255]);
    expect(pixel(10, 20)).toEqual([0, 0, 255, 255]);
    expect(session.getSnapshot().isDirty).toBe(true);
    session.undo();
    expect(pixel(10, 20)).toEqual([0, 0, 0, 0]);
    expect(pixel(10, 8)).toEqual([255, 0, 0, 255]);
    session.undo();
    expect(isDrawingBlank(session.getSnapshot().activeLayer.drawing)).toBe(true);
  });

  it('draws a dot for a single point and honors the opacity', () => {
    const { host, pixel } = setup();
    host.drawStrokes([{ points: [[10, 10]], color: RED, size: 6, opacity: 50 }], null, false);
    const [, , , alpha] = pixel(10, 10);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(255);
  });

  it("leaves the user's tool, color, brush, layer and stabilizer as they were", () => {
    const { host, session } = setup();
    session.setColor('#123456');
    session.setBrushSize(9);
    session.setBrushOpacity(70);
    session.setEraserSize(33);
    session.setStabilizeStroke(true);
    session.selectTool('bezier');
    session.addLayer();
    const first = session.getSnapshot().activeFrame.layers[1]?.id ?? '';
    const active = session.getSnapshot().activeLayer.id;
    host.drawStrokes([line()], first, false);
    const { state } = session.getSnapshot();
    expect(state).toMatchObject({ selectedTool: 'bezier', color: '#123456', brushSize: 9, brushOpacity: 70, eraserSize: 33, stabilizeStroke: true });
    expect(session.getSnapshot().activeLayer.id).toBe(active);
    expect(getPixel(session.getSnapshot().activeFrame.layers[1]?.drawing ?? session.getSnapshot().activeLayer.drawing, 10, 8)).toEqual([255, 0, 0, 255]);
  });

  it('erases along the given points', () => {
    const { host, pixel } = setup();
    host.drawStrokes([line()], null, false);
    host.drawStrokes([{ points: [[8, 8], [14, 8]], color: RED, size: 4, opacity: 100 }], null, true);
    expect(pixel(10, 8)).toEqual([0, 0, 0, 0]);
    expect(pixel(18, 8)).toEqual([255, 0, 0, 255]);
  });

  it('fills an area and rejects a point outside the canvas', () => {
    const { host, pixel } = setup();
    host.fillArea(5, 5, '#00ff00', null);
    expect(pixel(25, 25)).toEqual([0, 255, 0, 255]);
    expect(() => host.fillArea(SIZE, 0, '#00ff00', null)).toThrow('outside');
  });

  it('refuses to draw on a hidden layer, and stops playback before editing', () => {
    const { host, session } = setup();
    session.addFrame();
    session.togglePlayback();
    host.drawStrokes([line()], null, false);
    expect(session.getSnapshot().state.isPlaying).toBe(false);
    session.setLayerVisible(session.getSnapshot().activeLayer.id, false);
    expect(() => host.drawStrokes([line()], null, false)).toThrow('hidden');
    expect(() => host.fillArea(1, 1, RED, null)).toThrow('hidden');
  });
});

describe('structure', () => {
  it('adds, duplicates, selects, clears and removes frames', () => {
    const { host, session } = setup();
    host.drawStrokes([line()], null, false);
    const first = session.getSnapshot().activeFrame.id;
    const added = host.addFrame();
    expect(session.getSnapshot().frames).toHaveLength(2);
    expect(session.getSnapshot().activeFrame.id).toBe(added);
    host.selectFrame(first);
    const copy = host.duplicateFrame(null);
    expect(session.getSnapshot().frames.map((frame) => frame.id)).toContain(copy);
    host.clearFrame(first);
    expect(isDrawingBlank(session.getSnapshot().frames.find((frame) => frame.id === first)?.layers[0]?.drawing ?? session.getSnapshot().activeLayer.drawing)).toBe(true);
    host.removeFrame(copy);
    expect(session.getSnapshot().frames.map((frame) => frame.id)).not.toContain(copy);
    session.undo();
    expect(session.getSnapshot().frames.map((frame) => frame.id)).toContain(copy);
  });

  it('adds, renames, hides and removes layers', () => {
    const { host, session } = setup();
    const added = host.addLayer();
    expect(session.getSnapshot().activeLayer.id).toBe(added);
    host.renameLayer(added, 'Sketch');
    expect(session.getSnapshot().activeLayer.name).toBe('Sketch');
    host.setLayerVisible(added, false);
    expect(session.getSnapshot().activeLayer.visible).toBe(false);
    host.removeLayer(added);
    expect(session.getSnapshot().activeFrame.layers).toHaveLength(1);
    expect(() => host.renameLayer(session.getSnapshot().activeLayer.id, '   ')).toThrow(ToolExecutionError);
  });

  it('reports what the editor refuses as a tool error', () => {
    const { host, session } = setup();
    // The editor always keeps one frame, so removing the last one leaves a blank frame.
    host.removeFrame(host.getProjectInfo().activeFrameId);
    expect(session.getSnapshot().frames).toHaveLength(1);
    expect(() => host.removeLayer(host.getProjectInfo().activeLayerId)).toThrow(ToolExecutionError);
  });

  it('sets the FPS within the supported range', () => {
    const { host, session } = setup();
    host.setFps(12);
    expect(session.getSnapshot().state.fps).toBe(12);
    expect(() => host.setFps(500)).toThrow('FPS');
  });
});

describe('frame previews', () => {
  it('says so when the frame is empty', () => {
    const { host } = setup();
    const preview = host.previewFrame(null, 64);
    expect(preview.summary).toContain('no visible artwork');
    expect(preview.width).toBe(64);
  });

  it('describes where the artwork is, its colors and a coarse map of it, without any encoder', () => {
    const { host } = setup();
    host.drawStrokes([{ points: [[4, 16], [28, 16]], color: RED, size: 6, opacity: 100 }], null, false);
    const { summary, pngBase64 } = host.previewFrame(null, 128);
    expect(pngBase64).toBeNull();
    expect(summary).toContain('Canvas 32x32');
    expect(summary).toContain('#ff0000');
    expect(summary).toMatch(/within x \d+-\d+, y \d+-\d+/);
    const grid = summary.split('\n').slice(3);
    expect(grid.length).toBeGreaterThan(4);
    expect(grid.some((row) => row.includes('#'))).toBe(true);
    expect(grid.some((row) => /^\.+$/.test(row))).toBe(true);
  });

  it('renders over white and scales to fit', () => {
    const { host, session } = setup();
    host.drawStrokes([{ points: [[16, 16]], color: '#000000', size: 8, opacity: 100 }], null, false);
    const rendered = renderFrame(session.getSnapshot().activeFrame, SIZE, SIZE, 64);
    expect([rendered.width, rendered.height, rendered.scale]).toEqual([64, 64, 2]);
    expect(Array.from(rendered.rgba.slice(0, 4))).toEqual([255, 255, 255, 255]);
    const center = (32 * 64 + 32) * 4;
    expect(Array.from(rendered.rgba.slice(center, center + 4))).toEqual([0, 0, 0, 255]);
    expect(describeRendering(rendered, SIZE, SIZE)).toContain('Main colors: #000000');
  });
});

describe('shapes, curves and regions', () => {
  const shape = (overrides: Partial<Parameters<ReturnType<typeof setup>['host']['drawShape']>[0]> = {}) => ({
    kind: 'square' as const,
    center: [16, 16] as [number, number],
    size: 10,
    rotation: 0,
    color: RED,
    opacity: 100,
    fill: true,
    strokeWidth: 2,
    ...overrides
  });

  it('draws a filled shape as ordinary pixels in one undo step, leaving the editor options alone', () => {
    const { host, session, pixel } = setup();
    session.setColor('#123456');
    session.selectTool('bezier');
    host.drawShape(shape(), null);
    expect(pixel(16, 16)).toEqual([255, 0, 0, 255]);
    expect(pixel(4, 4)).toEqual([0, 0, 0, 0]);
    expect(session.getSnapshot().state).toMatchObject({ selectedTool: 'bezier', color: '#123456' });
    session.undo();
    expect(isDrawingBlank(session.getSnapshot().activeLayer.drawing)).toBe(true);
    expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('draws outlined shapes, rotated shapes and lines', () => {
    const { host, pixel } = setup();
    host.drawShape(shape({ fill: false, strokeWidth: 2 }), null);
    expect(pixel(16, 11)[3]).toBeGreaterThan(0);
    expect(pixel(16, 16)[3]).toBe(0);
    host.drawShape(shape({ kind: 'line', center: [16, 26], size: 20, rotation: 0, strokeWidth: 2 }), null);
    expect(pixel(8, 26)[3]).toBe(255);
    expect(pixel(8, 20)[3]).toBe(0);
  });

  it('draws on the layer that was asked for and keeps the active one', () => {
    const { host, session } = setup();
    session.addLayer();
    const upper = session.getSnapshot().activeLayer.id;
    const lower = session.getSnapshot().activeFrame.layers[1]?.id ?? '';
    host.drawShape(shape(), lower);
    expect(session.getSnapshot().activeLayer.id).toBe(upper);
    expect(isDrawingBlank(session.getSnapshot().activeFrame.layers[0]?.drawing ?? session.getSnapshot().activeLayer.drawing)).toBe(true);
    expect(isDrawingBlank(session.getSnapshot().activeFrame.layers[1]?.drawing ?? session.getSnapshot().activeLayer.drawing)).toBe(false);
    expect(() => host.drawShape(shape(), 'nope')).toThrow(ToolExecutionError);
  });

  it('draws a Bézier curve as pixels, not as an editable curve', () => {
    const { host, session, pixel } = setup();
    host.drawCurve({ anchors: [{ point: [4, 8], handleIn: [0, 0], handleOut: [0, 0] }, { point: [28, 8], handleIn: [0, 0], handleOut: [0, 0] }], brush: 'basic', color: RED, size: 4, opacity: 100 }, null);
    expect(pixel(16, 8)).toEqual([255, 0, 0, 255]);
    expect(pixel(16, 14)).toEqual([0, 0, 0, 0]);
    expect(session.getSnapshot().activeLayer.curves).toHaveLength(0);
    session.undo();
    expect(isDrawingBlank(session.getSnapshot().activeLayer.drawing)).toBe(true);
  });

  it('bends a curve with its handles, uses the chosen brush and refuses a curve that cannot be drawn', () => {
    const { host, pixel } = setup();
    host.drawCurve({ anchors: [{ point: [4, 16], handleIn: [0, 0], handleOut: [0, -12] }, { point: [28, 16], handleIn: [0, -12], handleOut: [0, 0] }], brush: 'basic', color: RED, size: 2, opacity: 100 }, null);
    expect(pixel(16, 8)[3]).toBeGreaterThan(0);
    expect(pixel(16, 16)[3]).toBe(0);
    expect(() => host.drawCurve({ anchors: [{ point: [4, 4], handleIn: [0, 0], handleOut: [0, 0] }, { point: [4, 4], handleIn: [0, 0], handleOut: [0, 0] }], brush: 'basic', color: RED, size: 2, opacity: 100 }, null)).toThrow(ToolExecutionError);
  });

  it('refuses to draw while the user has a shape waiting for confirmation', () => {
    const { host, session } = setup();
    session.selectTool('shape');
    session.pointerDown({ x: 10, y: 10, pointerId: 1, buttons: 1 });
    session.pointerUp({ x: 10, y: 10, pointerId: 1, buttons: 0 });
    expect(() => host.drawShape(shape(), null)).toThrow('waiting for confirmation');
    expect(isDrawingBlank(session.getSnapshot().activeLayer.drawing)).toBe(true);
  });

  const bar = (host: ReturnType<typeof setup>['host']) => host.drawStrokes([{ points: [[8, 16], [24, 16]], color: RED, size: 2, opacity: 100 }], null, false);

  it('rotates a region of artwork around its center through the Selection Tool, as one undo step', () => {
    const { host, session, pixel } = setup();
    bar(host);
    session.selectTool('brush');
    expect(host.transformRegion({ region: { x: 6, y: 12, width: 20, height: 8 }, rotation: 90, moveBy: [0, 0] }, null)).toBe(true);
    expect(session.getSnapshot().state.selectedTool).toBe('brush');
    expect(session.getSnapshot().state.selection).toBeNull();
    expect(pixel(16, 8)[3]).toBeGreaterThan(0);
    expect(pixel(16, 23)[3]).toBeGreaterThan(0);
    expect(pixel(8, 16)[3]).toBe(0);
    session.undo();
    expect(pixel(8, 16)[3]).toBeGreaterThan(0);
    expect(pixel(16, 8)[3]).toBe(0);
  });

  it('rotates by the same angle at any zoom and can move the region too', () => {
    const run = (zoom: number) => {
      const { host, session } = setup();
      session.setZoom(zoom);
      bar(host);
      host.transformRegion({ region: { x: 6, y: 12, width: 20, height: 8 }, rotation: 37, moveBy: [2, 3] }, null);
      return Array.from(session.getSnapshot().activeLayer.drawing.data ?? []);
    };
    expect(run(400)).toEqual(run(100));
    expect(run(25)).toEqual(run(100));
  });

  it('reports a region without artwork or outside the canvas', () => {
    const { host, session } = setup();
    expect(host.transformRegion({ region: { x: 0, y: 0, width: 4, height: 4 }, rotation: 45, moveBy: [0, 0] }, null)).toBe(false);
    expect(session.getSnapshot().canUndo).toBe(false);
    expect(() => host.transformRegion({ region: { x: 20, y: 20, width: 20, height: 20 }, rotation: 45, moveBy: [0, 0] }, null)).toThrow('outside');
  });
});
