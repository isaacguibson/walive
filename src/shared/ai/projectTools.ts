import type { ProjectAsset } from '../types/assets';
import { ToolExecutionError, type AIToolDefinition, type ApprovalDetails, type ToolOutput } from './tools';
import type { JsonSchema, ToolPermission } from './types';

export interface ProjectInfo {
  projectName: string;
  canvas: { width: number; height: number };
  fps: number;
  scene: { id: string; name: string };
  frameCount: number;
  activeFrameId: string;
  activeLayerId: string;
}

export interface FrameSummary {
  id: string;
  index: number;
  layerCount: number;
  active: boolean;
}

export interface LayerSummary {
  id: string;
  name: string;
  visible: boolean;
  hasArtwork: boolean;
  curveCount: number;
  active: boolean;
}

export interface FramePreview {
  width: number;
  height: number;
  /** Rendered frame as PNG; `null` when the environment cannot encode it. */
  pngBase64: string | null;
  /** Textual description of the artwork, for models that cannot see images. */
  summary: string;
}

export interface DrawStroke {
  points: [number, number][];
  color: string;
  size: number;
  opacity: number;
}

export const SHAPE_KINDS = ['square', 'triangle', 'circle', 'line'] as const;

/** A geometric shape, in canvas pixels. A line is `size` long and is centered on `center`. */
export interface AgentShape {
  kind: (typeof SHAPE_KINDS)[number];
  center: [number, number];
  size: number;
  /** Degrees, clockwise, around the center. */
  rotation: number;
  color: string;
  opacity: number;
  fill: boolean;
  strokeWidth: number;
}

export const CURVE_BRUSHES = ['basic', 'pencil', 'charcoal', 'chalk', 'particle'] as const;

/** A cubic Bézier path. Handles are offsets from their anchor; an omitted handle is none. */
export interface AgentCurve {
  anchors: { point: [number, number]; handleIn: [number, number]; handleOut: [number, number] }[];
  brush: string;
  color: string;
  size: number;
  opacity: number;
}

/** A rectangle of a layer whose pixels are turned and/or moved as one piece. */
export interface RegionTransform {
  region: { x: number; y: number; width: number; height: number };
  /** Degrees, clockwise, around the center of the region. */
  rotation: number;
  moveBy: [number, number];
}

/**
 * The operations of the open scene the agent may use. It is implemented by the editor, through its
 * normal drawing and history services, and throws `ToolExecutionError` for invalid targets.
 */
export interface ProjectToolHost {
  getProjectInfo(): ProjectInfo;
  listScenes(): Promise<{ activeSceneId: string; scenes: { id: string; name: string }[] }>;
  listFrames(): FrameSummary[];
  listLayers(frameId: string | null): LayerSummary[];
  previewFrame(frameId: string | null, maxSize: number): FramePreview;
  listAssets(): Promise<ProjectAsset[]>;
  drawStrokes(strokes: DrawStroke[], layerId: string | null, erase: boolean): number;
  fillArea(x: number, y: number, color: string, layerId: string | null): void;
  /** Paints the shape on the layer as ordinary pixels, as one undo step. */
  drawShape(shape: AgentShape, layerId: string | null): void;
  /** Paints the curve on the layer as ordinary pixels (it is not kept as an editable curve), as one undo step. */
  drawCurve(curve: AgentCurve, layerId: string | null): void;
  /** Turns and/or moves the pixels of a region of the layer through the Selection Tool. Returns `false` when the region holds no artwork. */
  transformRegion(transform: RegionTransform, layerId: string | null): boolean;
  addFrame(): string;
  duplicateFrame(frameId: string | null): string;
  selectFrame(frameId: string): void;
  removeFrame(frameId: string): void;
  clearFrame(frameId: string): void;
  addLayer(): string;
  renameLayer(layerId: string, name: string): void;
  setLayerVisible(layerId: string, visible: boolean): void;
  removeLayer(layerId: string): void;
  setFps(fps: number): void;
}

const COLOR = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: 'Color as #rrggbb.' };
const FRAME_ID = { type: 'string', minLength: 1, description: 'Frame id from list_frames.' };
const LAYER_ID = { type: 'string', minLength: 1, description: 'Layer id from get_frame_layers. Defaults to the active layer.' };
const POINT = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] in canvas pixels.' };
const POINTS = { type: 'array', items: POINT, minItems: 1, maxItems: 200 };
const OBJECT: JsonSchema = { type: 'object' };

function object(properties: Record<string, unknown>, required: string[] = []): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The application tools of the agent. `guard` runs before anything that changes the project and
 * throws when the agent is no longer allowed to touch it (for example, the scene changed).
 */
export function createProjectTools(host: ProjectToolHost, guard: () => void): AIToolDefinition[] {
  const frameLabel = (frameId: string | null): string => {
    const frame = host.listFrames().find((candidate) => (frameId === null ? candidate.active : candidate.id === frameId));
    return frame === undefined ? 'unknown frame' : `frame ${frame.index + 1}`;
  };
  const layerLabel = (layerId: string | null): string => {
    const layer = host.listLayers(null).find((candidate) => (layerId === null ? candidate.active : candidate.id === layerId));
    return layer === undefined ? 'the active frame has no such layer' : `layer "${layer.name}"`;
  };

  function define(
    id: string,
    title: string,
    permission: ToolPermission,
    description: string,
    inputSchema: JsonSchema,
    describe: (input: Record<string, unknown>) => Omit<ApprovalDetails, 'risk'> & { risk?: string },
    run: (input: Record<string, unknown>, supportsImages: boolean) => ToolOutput | Promise<ToolOutput>,
    resultSchema: JsonSchema = OBJECT
  ): AIToolDefinition {
    const modifies = permission !== 'read';
    return {
      id,
      title,
      description,
      permission,
      inputSchema,
      resultSchema,
      describe: (input) => ({ risk: null, ...describe(input) }),
      async execute(input, context) {
        if (modifies) {
          guard();
        }
        return run(input, context.supportsImages);
      }
    };
  }

  const strokeSchema = (extra: Record<string, unknown>, required: string[]) => ({
    type: 'array',
    minItems: 1,
    maxItems: 20,
    items: object({ points: POINTS, size: { type: 'number', minimum: 1, maximum: 200, description: 'Brush diameter in pixels.' }, ...extra }, required)
  });

  const strokesOf = (input: Record<string, unknown>): DrawStroke[] =>
    (input['strokes'] as Record<string, unknown>[]).map((stroke) => ({
      points: stroke['points'] as [number, number][],
      color: text(stroke['color']) ?? '#000000',
      size: stroke['size'] as number,
      opacity: typeof stroke['opacity'] === 'number' ? stroke['opacity'] : 100
    }));

  return [
    define('get_project_info', 'Get project info', 'read', 'Project name, canvas size, FPS, active scene, frame and layer.', object({}), () => ({
      operation: 'Read project information',
      target: 'Open project',
      effect: 'None'
    }), () => {
      const info = host.getProjectInfo();
      return { summary: `${info.projectName}, ${info.canvas.width}x${info.canvas.height}, ${info.frameCount} frame(s)`, data: info };
    }),

    define('list_scenes', 'List scenes', 'read', 'Scenes of the project and which one is open in the editor.', object({}), () => ({
      operation: 'List scenes',
      target: 'Open project',
      effect: 'None'
    }), async () => {
      const scenes = await host.listScenes();
      return { summary: `${scenes.scenes.length} scene(s)`, data: scenes };
    }),

    define('list_frames', 'List frames', 'read', 'Frames of the active scene in order.', object({}), () => ({
      operation: 'List frames',
      target: 'Active scene',
      effect: 'None'
    }), () => {
      const frames = host.listFrames();
      return { summary: `${frames.length} frame(s)`, data: { frames } };
    }),

    define('get_frame_layers', 'Get frame layers', 'read', 'Layers of a frame, top first, with visibility and whether they hold artwork.', object({ frameId: FRAME_ID }), () => ({
      operation: 'List layers',
      target: 'Frame',
      effect: 'None'
    }), (input) => {
      const layers = host.listLayers(text(input['frameId']));
      return { summary: `${layers.length} layer(s)`, data: { layers } };
    }),

    define(
      'render_frame_preview',
      'Render frame preview',
      'read',
      'Renders a frame. Models that accept images receive the picture; others receive a textual description of the artwork.',
      object({ frameId: FRAME_ID, maxSize: { type: 'integer', minimum: 32, maximum: 512, description: 'Longest side in pixels (default 256).' } }),
      () => ({ operation: 'Render a frame preview', target: 'Frame', effect: 'None' }),
      (input, supportsImages) => {
        const preview = host.previewFrame(text(input['frameId']), typeof input['maxSize'] === 'number' ? input['maxSize'] : 256);
        const sent = supportsImages && preview.pngBase64 !== null;
        return {
          summary: `Preview ${preview.width}x${preview.height}`,
          data: { width: preview.width, height: preview.height, imageAttached: sent, description: preview.summary },
          ...(sent && preview.pngBase64 !== null ? { images: [{ mediaType: 'image/png', data: preview.pngBase64 }] } : {})
        };
      }
    ),

    define('list_assets', 'List assets', 'read', 'Assets that belong to the project (names and types only).', object({}), () => ({
      operation: 'List project assets',
      target: 'Open project',
      effect: 'None'
    }), async () => {
      const assets = await host.listAssets();
      return {
        summary: `${assets.length} asset(s)`,
        data: { assets: assets.map(({ id, name, type, extension }) => ({ id, name, type, extension })) }
      };
    }),

    define(
      'draw_strokes',
      'Draw strokes',
      'modify',
      'Draws brush strokes on a layer of the active frame. Each stroke follows its points in order; one point draws a dot.',
      object({ layerId: LAYER_ID, strokes: strokeSchema({ color: COLOR, opacity: { type: 'integer', minimum: 1, maximum: 100 } }, ['points', 'size', 'color']) }, ['strokes']),
      (input) => ({
        operation: `Draw ${(input['strokes'] as unknown[]).length} stroke(s)`,
        target: `${layerLabel(text(input['layerId']))} of ${frameLabel(null)}`,
        effect: 'Adds artwork. Each stroke can be undone with Undo.'
      }),
      (input) => {
        const drawn = host.drawStrokes(strokesOf(input), text(input['layerId']), false);
        return { summary: `Drew ${drawn} stroke(s)`, data: { strokesDrawn: drawn, undoSteps: drawn } };
      }
    ),

    define(
      'erase_strokes',
      'Erase strokes',
      'modify',
      'Erases along the given points on a layer of the active frame.',
      object({ layerId: LAYER_ID, strokes: strokeSchema({}, ['points', 'size']) }, ['strokes']),
      (input) => ({
        operation: `Erase along ${(input['strokes'] as unknown[]).length} path(s)`,
        target: `${layerLabel(text(input['layerId']))} of ${frameLabel(null)}`,
        effect: 'Removes artwork. It can be undone with Undo.'
      }),
      (input) => {
        const erased = host.drawStrokes(strokesOf(input), text(input['layerId']), true);
        return { summary: `Erased ${erased} path(s)`, data: { pathsErased: erased, undoSteps: erased } };
      }
    ),

    define(
      'fill_area',
      'Fill area',
      'modify',
      'Flood-fills the connected area around a point of a layer of the active frame.',
      object({ layerId: LAYER_ID, x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, color: COLOR }, ['x', 'y', 'color']),
      (input) => ({
        operation: `Fill the area at (${String(input['x'])}, ${String(input['y'])})`,
        target: `${layerLabel(text(input['layerId']))} of ${frameLabel(null)}`,
        effect: 'Recolors one connected area. It can be undone with Undo.'
      }),
      (input) => {
        host.fillArea(input['x'] as number, input['y'] as number, text(input['color']) ?? '#000000', text(input['layerId']));
        return { summary: 'Filled an area', data: { filled: true, undoSteps: 1 } };
      }
    ),

    define(
      'draw_shape',
      'Draw shape',
      'modify',
      'Draws a square, equilateral triangle, circle or straight line on a layer of the active frame, as ordinary pixels. x and y are the center in canvas pixels. size is the side of a square or triangle, the diameter of a circle or the length of a line. Shapes are outlined unless fill is true; a line always uses strokeWidth.',
      object(
        {
          layerId: LAYER_ID,
          kind: { type: 'string', enum: [...SHAPE_KINDS] },
          x: { type: 'number', description: 'Center x in canvas pixels.' },
          y: { type: 'number', description: 'Center y in canvas pixels.' },
          size: { type: 'number', minimum: 1, maximum: 25000 },
          rotation: { type: 'number', minimum: -180, maximum: 180, description: 'Degrees, clockwise, around the center (default 0).' },
          color: COLOR,
          opacity: { type: 'integer', minimum: 1, maximum: 100 },
          fill: { type: 'boolean', description: 'Fill the shape instead of outlining it (default false).' },
          strokeWidth: { type: 'integer', minimum: 1, maximum: 100, description: 'Outline or line thickness in pixels (default 4).' }
        },
        ['kind', 'x', 'y', 'size', 'color']
      ),
      (input) => ({
        operation: `Draw a ${text(input['kind']) === 'line' ? 'straight line' : String(input['kind'])}`,
        target: `${layerLabel(text(input['layerId']))} of ${frameLabel(null)}`,
        effect: 'Adds artwork. It can be undone with Undo.'
      }),
      (input) => {
        const shape: AgentShape = {
          kind: text(input['kind']) as AgentShape['kind'],
          center: [input['x'] as number, input['y'] as number],
          size: input['size'] as number,
          rotation: typeof input['rotation'] === 'number' ? input['rotation'] : 0,
          color: text(input['color']) ?? '#000000',
          opacity: typeof input['opacity'] === 'number' ? input['opacity'] : 100,
          fill: input['fill'] === true,
          strokeWidth: typeof input['strokeWidth'] === 'number' ? input['strokeWidth'] : 4
        };
        host.drawShape(shape, text(input['layerId']));
        return { summary: `Drew a ${shape.kind}`, data: { drawn: true, undoSteps: 1 } };
      }
    ),

    define(
      'draw_bezier_curve',
      'Draw Bézier curve',
      'modify',
      'Draws a cubic Bézier curve through the anchors on a layer of the active frame, with the chosen brush, as ordinary pixels (it cannot be edited as a curve afterwards, only erased or transformed like any drawing). Each anchor is a point; handleIn and handleOut are optional [dx, dy] offsets from the anchor that bend the segments before and after it.',
      object(
        {
          layerId: LAYER_ID,
          anchors: {
            type: 'array',
            minItems: 2,
            maxItems: 100,
            items: object({ point: POINT, handleIn: { ...POINT, description: '[dx, dy] offset of the incoming handle.' }, handleOut: { ...POINT, description: '[dx, dy] offset of the outgoing handle.' } }, ['point'])
          },
          brush: { type: 'string', enum: [...CURVE_BRUSHES], description: 'Brush type (default basic).' },
          color: COLOR,
          size: { type: 'number', minimum: 1, maximum: 500, description: 'Brush diameter in pixels.' },
          opacity: { type: 'integer', minimum: 1, maximum: 100 }
        },
        ['anchors', 'color', 'size']
      ),
      (input) => ({
        operation: `Draw a Bézier curve with ${(input['anchors'] as unknown[]).length} anchors`,
        target: `${layerLabel(text(input['layerId']))} of ${frameLabel(null)}`,
        effect: 'Adds artwork. It can be undone with Undo.'
      }),
      (input) => {
        const offset = (value: unknown): [number, number] => (Array.isArray(value) ? [value[0] as number, value[1] as number] : [0, 0]);
        const curve: AgentCurve = {
          anchors: (input['anchors'] as Record<string, unknown>[]).map((anchor) => ({
            point: offset(anchor['point']),
            handleIn: offset(anchor['handleIn']),
            handleOut: offset(anchor['handleOut'])
          })),
          brush: text(input['brush']) ?? 'basic',
          color: text(input['color']) ?? '#000000',
          size: input['size'] as number,
          opacity: typeof input['opacity'] === 'number' ? input['opacity'] : 100
        };
        host.drawCurve(curve, text(input['layerId']));
        return { summary: 'Drew a Bézier curve', data: { drawn: true, undoSteps: 1 } };
      }
    ),

    define(
      'transform_region',
      'Transform region',
      'modify',
      'Selects a rectangle of a layer of the active frame with the Selection Tool and turns it around its center (rotation, degrees clockwise) and/or moves it by moveX, moveY pixels. Everything of that layer inside the rectangle is transformed, so choose the rectangle to hold only the artwork you mean. Transparency is kept and the rest of the layer is untouched.',
      object(
        {
          layerId: LAYER_ID,
          x: { type: 'integer', minimum: 0 },
          y: { type: 'integer', minimum: 0 },
          width: { type: 'integer', minimum: 1 },
          height: { type: 'integer', minimum: 1 },
          rotation: { type: 'number', minimum: -180, maximum: 180 },
          moveX: { type: 'integer' },
          moveY: { type: 'integer' }
        },
        ['x', 'y', 'width', 'height']
      ),
      (input) => ({
        operation: 'Transform a region of artwork',
        target: `${layerLabel(text(input['layerId']))} of ${frameLabel(null)}, region ${String(input['width'])}x${String(input['height'])} at (${String(input['x'])}, ${String(input['y'])})`,
        effect: 'Turns and/or moves the pixels of the region. It can be undone with Undo.'
      }),
      (input) => {
        const rotation = typeof input['rotation'] === 'number' ? input['rotation'] : 0;
        const moveBy: [number, number] = [typeof input['moveX'] === 'number' ? input['moveX'] : 0, typeof input['moveY'] === 'number' ? input['moveY'] : 0];
        if (rotation === 0 && moveBy[0] === 0 && moveBy[1] === 0) {
          throw new ToolExecutionError('Give a rotation or a move; otherwise there is nothing to transform.');
        }
        const region = { x: input['x'] as number, y: input['y'] as number, width: input['width'] as number, height: input['height'] as number };
        const changed = host.transformRegion({ region, rotation, moveBy }, text(input['layerId']));
        if (!changed) {
          throw new ToolExecutionError('The region holds no artwork on that layer, so nothing was transformed.');
        }
        return { summary: 'Transformed a region', data: { transformed: true, undoSteps: 1 } };
      }
    ),

    define('add_frame', 'Add frame', 'modify', 'Adds an empty frame after the active one and selects it.', object({}), () => ({
      operation: 'Add a frame',
      target: 'Active scene',
      effect: 'Inserts one empty frame.'
    }), () => {
      const frameId = host.addFrame();
      return { summary: 'Added a frame', data: { frameId } };
    }),

    define('duplicate_frame', 'Duplicate frame', 'modify', 'Duplicates a frame (default: the active one) right after itself.', object({ frameId: FRAME_ID }), (input) => ({
      operation: 'Duplicate a frame',
      target: frameLabel(text(input['frameId'])),
      effect: 'Inserts a copy of the frame and its layers.'
    }), (input) => {
      const frameId = host.duplicateFrame(text(input['frameId']));
      return { summary: 'Duplicated a frame', data: { frameId } };
    }),

    define('select_frame', 'Select frame', 'modify', 'Makes a frame the active one, so that drawing tools target it.', object({ frameId: FRAME_ID }, ['frameId']), (input) => ({
      operation: 'Select a frame',
      target: frameLabel(text(input['frameId'])),
      effect: 'Changes the frame shown in the editor.'
    }), (input) => {
      host.selectFrame(text(input['frameId']) ?? '');
      return { summary: 'Selected a frame', data: { activeFrameId: input['frameId'] } };
    }),

    define('add_layer', 'Add layer', 'modify', 'Adds an empty layer to the active frame and selects it.', object({}), () => ({
      operation: 'Add a layer',
      target: frameLabel(null),
      effect: 'Inserts one empty layer.'
    }), () => {
      const layerId = host.addLayer();
      return { summary: 'Added a layer', data: { layerId } };
    }),

    define('rename_layer', 'Rename layer', 'modify', 'Renames a layer of the active frame.', object({ layerId: LAYER_ID, name: { type: 'string', minLength: 1, maxLength: 60 } }, ['layerId', 'name']), (input) => ({
      operation: `Rename a layer to "${String(input['name'])}"`,
      target: layerLabel(text(input['layerId'])),
      effect: 'Changes the layer name.'
    }), (input) => {
      host.renameLayer(text(input['layerId']) ?? '', text(input['name']) ?? '');
      return { summary: 'Renamed a layer', data: { renamed: true } };
    }),

    define('set_layer_visibility', 'Set layer visibility', 'modify', 'Shows or hides a layer of the active frame.', object({ layerId: LAYER_ID, visible: { type: 'boolean' } }, ['layerId', 'visible']), (input) => ({
      operation: input['visible'] === true ? 'Show a layer' : 'Hide a layer',
      target: layerLabel(text(input['layerId'])),
      effect: 'Changes whether the layer is drawn.'
    }), (input) => {
      host.setLayerVisible(text(input['layerId']) ?? '', input['visible'] === true);
      return { summary: input['visible'] === true ? 'Showed a layer' : 'Hid a layer', data: { visible: input['visible'] === true } };
    }),

    define('set_fps', 'Set FPS', 'modify', 'Sets the playback speed of the animation in frames per second.', object({ fps: { type: 'integer', minimum: 1, maximum: 120 } }, ['fps']), (input) => ({
      operation: `Set FPS to ${String(input['fps'])}`,
      target: 'Active scene',
      effect: 'Changes the playback speed.'
    }), (input) => {
      host.setFps(input['fps'] as number);
      return { summary: `FPS set to ${String(input['fps'])}`, data: { fps: input['fps'] } };
    }),

    define('delete_frame', 'Delete frame', 'sensitive', 'Deletes a frame and all of its layers.', object({ frameId: FRAME_ID }, ['frameId']), (input) => ({
      operation: 'Delete a frame',
      target: frameLabel(text(input['frameId'])),
      effect: 'Removes the frame and its artwork from the scene.',
      risk: 'Destructive. It can be undone with Undo until the project is closed.'
    }), (input) => {
      host.removeFrame(text(input['frameId']) ?? '');
      return { summary: 'Deleted a frame', data: { deleted: true } };
    }),

    define('clear_frame', 'Clear frame', 'sensitive', 'Removes all artwork from a frame, keeping its layers.', object({ frameId: FRAME_ID }, ['frameId']), (input) => ({
      operation: 'Clear a frame',
      target: frameLabel(text(input['frameId'])),
      effect: 'Erases every drawing of the frame.',
      risk: 'Destructive. It can be undone with Undo until the project is closed.'
    }), (input) => {
      host.clearFrame(text(input['frameId']) ?? '');
      return { summary: 'Cleared a frame', data: { cleared: true } };
    }),

    define('delete_layer', 'Delete layer', 'sensitive', 'Deletes a layer of the active frame and its artwork.', object({ layerId: { ...LAYER_ID, description: 'Layer id from get_frame_layers.' } }, ['layerId']), (input) => ({
      operation: 'Delete a layer',
      target: layerLabel(text(input['layerId'])),
      effect: 'Removes the layer and its artwork.',
      risk: 'Destructive. It can be undone with Undo until the project is closed.'
    }), (input) => {
      host.removeLayer(text(input['layerId']) ?? '');
      return { summary: 'Deleted a layer', data: { deleted: true } };
    })
  ];
}
