/**
 * Domain model of the animation editor (HU_00004 §43-§46).
 *
 * Frames and layers are treated as immutable values: structural changes create
 * new objects (which makes undo a matter of swapping references). Only the
 * pixel buffer of a `DrawingData` is mutated in place, and only through the
 * stroke/patch mechanism so every change is undoable.
 */

export type ToolType = 'brush' | 'eraser' | 'fill' | 'eyedropper' | 'selection';

export type BrushId = 'basic' | 'pencil' | 'charcoal' | 'chalk' | 'particle';

/** Brush-specific options by key. Every brush defines its own keys (see `BrushDefinition.options`). */
export type BrushSettings = Readonly<Record<string, number>>;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

/** Raster content of one layer. Logical size is the project canvas size. */
export interface DrawingData {
  readonly width: number;
  readonly height: number;
  /** Non-premultiplied RGBA, row-major. `null` means fully transparent and not yet allocated. */
  data: Uint8ClampedArray | null;
  /** Incremented on every pixel change; renderers compare it to know when to re-upload. */
  revision: number;
  /** Union of the pixels changed since a renderer last consumed it. */
  dirty: Rect | null;
}

export interface Layer {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly drawing: DrawingData;
}

export interface Frame {
  readonly id: string;
  /** Top-most layer first: the first layer is rendered above the following ones. */
  readonly layers: readonly Layer[];
}

/** Application/editor level clipboard for frames (HU_00004 §29). */
export interface FrameClipboard {
  operation: 'copy' | 'cut';
  frame: Frame;
}

export interface EditorState {
  activeFrameId: string | null;
  activeLayerId: string | null;
  selectedTool: ToolType;
  zoom: number;
  fps: number;
  loopPlayback: boolean;
  isPlaying: boolean;
  /** Active drawing color as `#rrggbb`. Shared by the tools that use a color. */
  color: string;
  brushSize: number;
  /** Base opacity of brush strokes, in percent (0-100). */
  brushOpacity: number;
  brushType: BrushId;
  /** Settings of the selected brush type; every type keeps its own for the whole session. */
  brushSettings: BrushSettings;
  usePenPressure: boolean;
  usePenPressureOpacity: boolean;
  stabilizeStroke: boolean;
  eraserSize: number;
  /** Rectangle chosen with the Selection tool, in canvas pixels. */
  selection: Rect | null;
}

export interface EditorDocumentState {
  isDirty: boolean;
}
