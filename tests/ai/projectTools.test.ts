import { describe, expect, it, vi } from 'vitest';
import { validateSchema } from '@shared/ai/schema';
import { AIToolRegistry, ToolExecutionError, type AIToolDefinition } from '@shared/ai/tools';
import { createProjectTools, type ProjectToolHost } from '@shared/ai/projectTools';

function fakeHost(overrides: Partial<ProjectToolHost> = {}): ProjectToolHost {
  return {
    getProjectInfo: () => ({ projectName: 'Studio', canvas: { width: 64, height: 64 }, fps: 24, scene: { id: 's1', name: 'Intro' }, frameCount: 2, activeFrameId: 'f1', activeLayerId: 'l1' }),
    listScenes: async () => ({ activeSceneId: 's1', scenes: [{ id: 's1', name: 'Intro' }] }),
    listFrames: () => [
      { id: 'f1', index: 0, layerCount: 1, active: true },
      { id: 'f2', index: 1, layerCount: 1, active: false }
    ],
    listLayers: () => [{ id: 'l1', name: 'Ink', visible: true, hasArtwork: false, curveCount: 0, active: true }],
    previewFrame: () => ({ width: 64, height: 64, pngBase64: 'AAAA', summary: 'Empty canvas' }),
    listAssets: async () => [{ id: 'assets/images/a.png', name: 'a.png', type: 'image', relativePath: 'assets/images/a.png', extension: 'png' }],
    drawStrokes: vi.fn((strokes) => strokes.length),
    fillArea: vi.fn(),
    addFrame: vi.fn(() => 'f3'),
    duplicateFrame: vi.fn(() => 'f4'),
    selectFrame: vi.fn(),
    removeFrame: vi.fn(),
    clearFrame: vi.fn(),
    addLayer: vi.fn(() => 'l2'),
    renameLayer: vi.fn(),
    setLayerVisible: vi.fn(),
    removeLayer: vi.fn(),
    setFps: vi.fn(),
    ...overrides
  };
}

const find = (tools: AIToolDefinition[], id: string): AIToolDefinition => {
  const found = tools.find((tool) => tool.id === id);
  if (found === undefined) {
    throw new Error(`No tool ${id}`);
  }
  return found;
};

const CONTEXT = { signal: new AbortController().signal, supportsImages: false };

describe('application tools', () => {
  it('classifies every tool', () => {
    const tools = createProjectTools(fakeHost(), () => undefined);
    const byPermission = (permission: string) => tools.filter((tool) => tool.permission === permission).map((tool) => tool.id).sort();
    expect(byPermission('read')).toEqual(['get_frame_layers', 'get_project_info', 'list_assets', 'list_frames', 'list_scenes', 'render_frame_preview']);
    expect(byPermission('modify')).toEqual(['add_frame', 'add_layer', 'draw_strokes', 'duplicate_frame', 'erase_strokes', 'fill_area', 'rename_layer', 'select_frame', 'set_fps', 'set_layer_visibility']);
    expect(byPermission('sensitive')).toEqual(['clear_frame', 'delete_frame', 'delete_layer']);
    expect(byPermission('external')).toEqual([]);
  });

  it('defines each tool completely and registers without conflicts', () => {
    const registry = new AIToolRegistry();
    for (const tool of createProjectTools(fakeHost(), () => undefined)) {
      expect(tool.title).not.toBe('');
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema['type']).toBe('object');
      expect(tool.inputSchema['additionalProperties']).toBe(false);
      expect(tool.resultSchema).toBeDefined();
      registry.register(tool);
    }
    expect(registry.list()).toHaveLength(19);
  });

  it('inspects the project through read-only tools', async () => {
    const tools = createProjectTools(fakeHost(), () => {
      throw new Error('guard must not run for read-only tools');
    });
    expect(await find(tools, 'get_project_info').execute({}, CONTEXT)).toMatchObject({ data: { projectName: 'Studio', canvas: { width: 64, height: 64 }, fps: 24 } });
    expect(await find(tools, 'list_frames').execute({}, CONTEXT)).toMatchObject({ summary: '2 frame(s)' });
    expect(await find(tools, 'get_frame_layers').execute({}, CONTEXT)).toMatchObject({ data: { layers: [{ name: 'Ink' }] } });
    expect(await find(tools, 'list_scenes').execute({}, CONTEXT)).toMatchObject({ data: { activeSceneId: 's1' } });
    expect(await find(tools, 'list_assets').execute({}, CONTEXT)).toMatchObject({ data: { assets: [{ id: 'assets/images/a.png', name: 'a.png', type: 'image', extension: 'png' }] } });
  });

  it('returns a rendering only to models that accept images, and always a textual description', async () => {
    const tool = find(createProjectTools(fakeHost(), () => undefined), 'render_frame_preview');
    const withImages = await tool.execute({}, { ...CONTEXT, supportsImages: true });
    expect(withImages.images).toEqual([{ mediaType: 'image/png', data: 'AAAA' }]);
    expect(withImages.data).toMatchObject({ imageAttached: true, description: 'Empty canvas' });
    const without = await tool.execute({}, CONTEXT);
    expect(without.images).toBeUndefined();
    expect(without.data).toMatchObject({ imageAttached: false, description: 'Empty canvas' });
  });

  it('runs the guard before anything that changes the project, and does not touch the project when it refuses', async () => {
    const host = fakeHost();
    const guard = vi.fn(() => {
      throw new ToolExecutionError('The open scene changed.');
    });
    const tools = createProjectTools(host, guard);
    await expect(find(tools, 'add_frame').execute({}, CONTEXT)).rejects.toThrow('The open scene changed.');
    await expect(find(tools, 'draw_strokes').execute({ strokes: [{ points: [[1, 1]], size: 2, color: '#ff0000' }] }, CONTEXT)).rejects.toThrow();
    await expect(find(tools, 'delete_frame').execute({ frameId: 'f2' }, CONTEXT)).rejects.toThrow();
    expect(host.addFrame).not.toHaveBeenCalled();
    expect(host.drawStrokes).not.toHaveBeenCalled();
    expect(host.removeFrame).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalledTimes(3);
  });

  it('draws strokes with their defaults and reports the undo steps', async () => {
    const host = fakeHost();
    const tools = createProjectTools(host, () => undefined);
    const output = await find(tools, 'draw_strokes').execute({ layerId: 'l1', strokes: [{ points: [[1, 1], [5, 5]], size: 4, color: '#ff0000' }] }, CONTEXT);
    expect(host.drawStrokes).toHaveBeenCalledWith([{ points: [[1, 1], [5, 5]], color: '#ff0000', size: 4, opacity: 100 }], 'l1', false);
    expect(output).toMatchObject({ summary: 'Drew 1 stroke(s)', data: { strokesDrawn: 1, undoSteps: 1 } });
    await find(tools, 'erase_strokes').execute({ strokes: [{ points: [[1, 1]], size: 3 }] }, CONTEXT);
    expect(host.drawStrokes).toHaveBeenLastCalledWith([{ points: [[1, 1]], color: '#000000', size: 3, opacity: 100 }], null, true);
  });

  it('validates the arguments the model sends before they reach the host', () => {
    const tools = createProjectTools(fakeHost(), () => undefined);
    const draw = find(tools, 'draw_strokes').inputSchema;
    expect(validateSchema(draw, { strokes: [{ points: [[1, 1]], size: 4, color: '#ff0000' }] })).toEqual([]);
    expect(validateSchema(draw, { strokes: [{ points: [[1, 1]], size: 4, color: 'red' }] })).toEqual(['input.strokes[0].color has an invalid format']);
    expect(validateSchema(draw, { strokes: [{ points: [], size: 4, color: '#ff0000' }] })[0]).toContain('item count');
    expect(validateSchema(draw, { strokes: [{ points: [[1, 1]], size: 500, color: '#ff0000' }] })[0]).toContain('at most 200');
    expect(validateSchema(draw, { strokes: [] })[0]).toContain('item count');
    expect(validateSchema(draw, {})).toEqual(['input.strokes is required']);
    expect(validateSchema(find(tools, 'set_fps').inputSchema, { fps: 500 })[0]).toContain('at most 120');
    expect(validateSchema(find(tools, 'delete_frame').inputSchema, {})).toEqual(['input.frameId is required']);
  });

  it('describes what an approval would allow, with the target and the risk of destructive operations', () => {
    const tools = createProjectTools(fakeHost(), () => undefined);
    expect(find(tools, 'delete_frame').describe({ frameId: 'f2' })).toEqual({
      operation: 'Delete a frame',
      target: 'frame 2',
      effect: 'Removes the frame and its artwork from the scene.',
      risk: 'Destructive. It can be undone with Undo until the project is closed.'
    });
    expect(find(tools, 'delete_layer').describe({ layerId: 'l1' })).toMatchObject({ target: 'layer "Ink"' });
    expect(find(tools, 'draw_strokes').describe({ strokes: [{}, {}] })).toMatchObject({ operation: 'Draw 2 stroke(s)', target: 'layer "Ink" of frame 1', risk: null });
  });

  it('creates frames and layers and reports their ids', async () => {
    const host = fakeHost();
    const tools = createProjectTools(host, () => undefined);
    expect((await find(tools, 'add_frame').execute({}, CONTEXT)).data).toEqual({ frameId: 'f3' });
    expect((await find(tools, 'duplicate_frame').execute({ frameId: 'f1' }, CONTEXT)).data).toEqual({ frameId: 'f4' });
    expect((await find(tools, 'add_layer').execute({}, CONTEXT)).data).toEqual({ layerId: 'l2' });
    await find(tools, 'set_layer_visibility').execute({ layerId: 'l1', visible: false }, CONTEXT);
    expect(host.setLayerVisible).toHaveBeenCalledWith('l1', false);
    await find(tools, 'clear_frame').execute({ frameId: 'f1' }, CONTEXT);
    expect(host.clearFrame).toHaveBeenCalledWith('f1');
  });
});
