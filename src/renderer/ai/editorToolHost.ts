import type { EditorSession } from '@editor/editorSession';
import type { Frame, Layer, ToolType } from '@editor/model';
import { rotatePoint } from '@editor/angles';
import { findBrush } from '@editor/brushes/registry';
import { SELECTION_ROTATE_HANDLE_SCREEN_PX } from '@editor/constants';
import { isDrawingBlank } from '@editor/drawing/raster';
import { ToolExecutionError } from '@shared/ai/tools';
import type { DrawStroke, FrameSummary, LayerSummary, ProjectToolHost } from '@shared/ai/projectTools';
import type { AssetsAPI, ScenesAPI } from '@shared/types/api';
import { describeRendering, encodePng, renderFrame } from './framePreview';

const POINTER_ID = 7_001;

export interface EditorHostDependencies {
  session: EditorSession;
  projectName: string;
  scene: { id: string; name: string };
  scenesApi: ScenesAPI;
  assetsApi: AssetsAPI;
}

/**
 * Lets the agent act on the open scene through the editor's own services: strokes are replayed as
 * pointer input (so they are drawn and undone like the user's), and structure changes use the same
 * session methods as the buttons. The user's tool, color and active layer are restored afterwards.
 */
export function createEditorToolHost({ session, projectName, scene, scenesApi, assetsApi }: EditorHostDependencies): ProjectToolHost {
  const snapshot = () => session.getSnapshot();

  function frameOf(frameId: string | null): Frame {
    const frame = frameId === null ? snapshot().activeFrame : snapshot().frames.find((candidate) => candidate.id === frameId);
    if (frame === undefined) {
      throw new ToolExecutionError('There is no frame with that id. Use list_frames to see the valid ids.');
    }
    return frame;
  }

  function layerOf(layerId: string | null): Layer {
    const layer = layerId === null ? snapshot().activeLayer : snapshot().activeFrame.layers.find((candidate) => candidate.id === layerId);
    if (layer === undefined) {
      throw new ToolExecutionError('There is no layer with that id in the active frame. Use get_frame_layers to see the valid ids.');
    }
    return layer;
  }

  /** Runs an editor operation and turns an error the editor reported into a tool failure. */
  function perform<T>(operation: () => T): T {
    if (snapshot().state.shapeEditor.pending !== null) {
      throw new ToolExecutionError('A shape is waiting for confirmation in the editor. Ask the user to confirm or cancel it first.');
    }
    session.stop();
    session.clearError();
    const result = operation();
    const { error } = snapshot();
    if (error !== null) {
      throw new ToolExecutionError(error);
    }
    return result;
  }

  /** Runs `operation` with `tool` selected on `layerId`, then puts the user's tool settings back. */
  function withTool<T>(tool: ToolType, layerId: string | null, operation: () => T): T {
    const target = layerOf(layerId);
    if (!target.visible) {
      throw new ToolExecutionError('The layer is hidden. Show it with set_layer_visibility first.');
    }
    return perform(() => {
      const { state } = snapshot();
      const previous = { tool: state.selectedTool, color: state.color, size: state.brushSize, opacity: state.brushOpacity, eraser: state.eraserSize, stabilize: state.stabilizeStroke, layer: snapshot().activeLayer.id };
      try {
        session.selectLayer(target.id);
        session.setStabilizeStroke(false);
        session.selectTool(tool);
        return operation();
      } finally {
        session.selectTool(previous.tool);
        session.setColor(previous.color);
        session.setBrushSize(previous.size);
        session.setBrushOpacity(previous.opacity);
        session.setEraserSize(previous.eraser);
        session.setStabilizeStroke(previous.stabilize);
        if (previous.layer !== target.id && snapshot().activeFrame.layers.some((layer) => layer.id === previous.layer)) {
          session.selectLayer(previous.layer);
        }
      }
    });
  }

  function replay(points: [number, number][]): void {
    const [first, ...rest] = points;
    if (first === undefined) {
      return;
    }
    const last = rest[rest.length - 1] ?? first;
    session.pointerDown({ x: first[0], y: first[1], pointerId: POINTER_ID, buttons: 1 });
    for (const [x, y] of rest) {
      session.pointerMove({ x, y, pointerId: POINTER_ID, buttons: 1 });
    }
    session.pointerUp({ x: last[0], y: last[1], pointerId: POINTER_ID, buttons: 0 });
  }

  /** Id of the frame or layer that appeared after `operation`. */
  function created(ids: () => string[], operation: () => void): string {
    const before = new Set(ids());
    perform(operation);
    const id = ids().find((candidate) => !before.has(candidate));
    if (id === undefined) {
      throw new ToolExecutionError('The editor did not create anything.');
    }
    return id;
  }

  const frameIds = (): string[] => snapshot().frames.map((frame) => frame.id);
  const layerIds = (): string[] => snapshot().activeFrame.layers.map((layer) => layer.id);

  return {
    getProjectInfo: () => ({
      projectName,
      canvas: { width: snapshot().width, height: snapshot().height },
      fps: snapshot().state.fps,
      scene,
      frameCount: snapshot().frames.length,
      activeFrameId: snapshot().activeFrame.id,
      activeLayerId: snapshot().activeLayer.id
    }),

    async listScenes() {
      const result = await scenesApi.listScenes();
      if (!result.ok) {
        throw new ToolExecutionError(result.error.message);
      }
      return { activeSceneId: result.value.activeSceneId, scenes: result.value.scenes.map(({ id, name }) => ({ id, name })) };
    },

    listFrames: (): FrameSummary[] =>
      snapshot().frames.map((frame, index) => ({ id: frame.id, index, layerCount: frame.layers.length, active: frame.id === snapshot().activeFrame.id })),

    listLayers: (frameId): LayerSummary[] =>
      frameOf(frameId).layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        hasArtwork: !isDrawingBlank(layer.drawing) || layer.curves.length > 0,
        curveCount: layer.curves.length,
        active: layer.id === snapshot().activeLayer.id
      })),

    previewFrame(frameId, maxSize) {
      const rendered = renderFrame(frameOf(frameId), snapshot().width, snapshot().height, maxSize);
      return { width: rendered.width, height: rendered.height, pngBase64: encodePng(rendered), summary: describeRendering(rendered, snapshot().width, snapshot().height) };
    },

    async listAssets() {
      const result = await assetsApi.listAssets();
      if (!result.ok) {
        throw new ToolExecutionError(result.error.message);
      }
      return result.value;
    },

    drawStrokes(strokes: DrawStroke[], layerId, erase) {
      return withTool(erase ? 'eraser' : 'brush', layerId, () => {
        for (const stroke of strokes) {
          if (erase) {
            session.setEraserSize(stroke.size);
          } else {
            session.setColor(stroke.color);
            session.setBrushSize(stroke.size);
            session.setBrushOpacity(stroke.opacity);
          }
          replay(stroke.points);
        }
        return strokes.length;
      });
    },

    fillArea(x, y, color, layerId) {
      if (x >= snapshot().width || y >= snapshot().height) {
        throw new ToolExecutionError(`The point is outside the ${snapshot().width}x${snapshot().height} canvas.`);
      }
      withTool('fill', layerId, () => {
        session.setColor(color);
        replay([[x + 0.5, y + 0.5]]);
      });
    },

    drawShape(shape, layerId) {
      withTool(snapshot().state.selectedTool, layerId, () => {
        const [x, y] = shape.center;
        const drawn = session.drawShape({ ...shape, center: { x, y } });
        if (!drawn) {
          throw new ToolExecutionError('The shape could not be drawn.');
        }
      });
    },

    drawCurve(curve, layerId) {
      const brush = findBrush(curve.brush);
      withTool(snapshot().state.selectedTool, layerId, () => {
        const anchors = curve.anchors.map(({ point, handleIn, handleOut }) => ({
          x: point[0],
          y: point[1],
          type: 'corner' as const,
          handleIn: { x: handleIn[0], y: handleIn[1] },
          handleOut: { x: handleOut[0], y: handleOut[1] }
        }));
        const style = { brush: brush.id, settings: brush.defaultSettings, color: curve.color, size: curve.size, opacity: curve.opacity };
        if (!session.drawCurve(anchors, style)) {
          throw new ToolExecutionError(snapshot().error ?? 'The curve could not be drawn.');
        }
      });
    },

    transformRegion({ region, rotation, moveBy }, layerId) {
      if (region.x + region.width > snapshot().width || region.y + region.height > snapshot().height) {
        throw new ToolExecutionError(`The region is outside the ${snapshot().width}x${snapshot().height} canvas.`);
      }
      return withTool('select', layerId, () => {
        replay([[region.x, region.y], [region.x + region.width, region.y + region.height]]);
        const selected = snapshot().state.selection;
        if (selected === null || selected.creating) {
          throw new ToolExecutionError('The region could not be selected.');
        }
        const center = { x: selected.rect.x + selected.rect.width / 2, y: selected.rect.y + selected.rect.height / 2 };
        if (rotation !== 0) {
          // The rotation handle sits a fixed number of screen pixels above the selection, whatever the zoom.
          const handle = { x: center.x, y: selected.rect.y - SELECTION_ROTATE_HANDLE_SCREEN_PX / (snapshot().state.zoom / 100) };
          const target = rotatePoint(handle, rotation, center);
          replay([[handle.x, handle.y], [target.x, target.y]]);
        }
        if (moveBy[0] !== 0 || moveBy[1] !== 0) {
          replay([[center.x, center.y], [center.x + moveBy[0], center.y + moveBy[1]]]);
        }
        const changed = snapshot().state.selection?.pending === true;
        session.commitSelection();
        return changed;
      });
    },

    addFrame: () => created(frameIds, () => session.addFrame()),
    duplicateFrame: (frameId) => created(frameIds, () => session.duplicateFrame(frameOf(frameId).id)),
    selectFrame: (frameId) => perform(() => session.selectFrame(frameOf(frameId).id)),
    removeFrame: (frameId) => perform(() => session.removeFrame(frameOf(frameId).id)),
    clearFrame: (frameId) => perform(() => session.clearFrame(frameOf(frameId).id)),
    addLayer: () => created(layerIds, () => session.addLayer()),
    renameLayer: (layerId, name) => {
      if (!perform(() => session.renameLayer(layerOf(layerId).id, name))) {
        throw new ToolExecutionError('The layer name is not valid.');
      }
    },
    setLayerVisible: (layerId, visible) => perform(() => session.setLayerVisible(layerOf(layerId).id, visible)),
    removeLayer: (layerId) => perform(() => session.removeLayer(layerOf(layerId).id)),
    setFps: (fps) => {
      if (!perform(() => session.setFps(fps))) {
        throw new ToolExecutionError('The FPS value is not valid.');
      }
    }
  };
}
