/**
 * Domain model of the animation editor (HU_00004 §43-§46).
 *
 * Frames and layers are treated as immutable values: structural changes create
 * new objects (which makes undo a matter of swapping references). Only the
 * pixel buffer of a `DrawingData` is mutated in place, and only through the
 * stroke/patch mechanism so every change is undoable.
 */

import type { BezierCurve } from './curves/curve';
import type { CurveCache } from './curves/render';

export type ToolType = 'brush' | 'bezier' | 'eraser' | 'fill';

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

/** Size, opacity and brush type of a tool that paints with the brush engine. */
export interface BrushConfigState {
  readonly size: number;
  /** Base opacity in percent (0-100). */
  readonly opacity: number;
  readonly type: BrushId;
  /** Settings of the selected brush type; every type keeps its own for the whole session. */
  readonly settings: BrushSettings;
}

/** What the Bézier tool is working on. Curves themselves live on the layers. */
export interface CurveEditorState {
  /** Path being created: not on the layer until it is finished. */
  readonly draft: BezierCurve | null;
  readonly selectedCurveId: string | null;
  /** Index of the selected anchor of the selected curve or draft. */
  readonly selectedAnchor: number | null;
}

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
  /** Bézier curves, drawn above `drawing`, bottom first. Replaced (never edited) when they change. */
  readonly curves: readonly BezierCurve[];
  /** Derived raster of `curves`; shared by the copies of a layer that differ only in their curves. */
  readonly curveCache: CurveCache;
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
  /** Options of the Bézier tool, which keeps its own brush options apart from the Brush tool. */
  curveBrush: BrushConfigState;
  curveEditor: CurveEditorState;
}

export interface EditorDocumentState {
  isDirty: boolean;
}
