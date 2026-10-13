import type { BrushDefinition } from '../brushes/brush';
import type { BezierCurve, CurveStyle } from '../curves/curve';
import type { CurveEdit } from '../curves/curveEdit';
import type {
  BrushSettings,
  CurveEditorState,
  DrawingData,
  Point,
  Rect,
  Rgb,
  SelectionOptions,
  SelectionState,
  ToolType
} from '../model';

/** Pointer position already converted to logical canvas pixels (HU_00004 §33, §55). */
export interface ToolPointerEvent {
  readonly x: number;
  readonly y: number;
  readonly pointerId: number;
  readonly pointerType?: string;
  readonly pressure?: number;
  /** Pressed buttons bitmask. `0` while a gesture is active means the button was released elsewhere. */
  readonly buttons?: number;
}

/** What a tool may do to the editor. Tools never touch frames, layers or files directly. */
export interface StrokeHandle {
  /** `original` holds the pixels as they were before the gesture (`null` when the drawing was blank). */
  apply(operation: (drawing: DrawingData, original: Uint8ClampedArray | null) => Rect | null): void;
  commit(): boolean;
  cancel(): void;
}

export interface ToolContext {
  readonly width: number;
  readonly height: number;
  /** Starts a gesture on the active layer; `null` (after reporting the reason) when drawing is not possible. */
  beginStroke(label: string): StrokeHandle | null;
  getColor(): Rgb;
  getBrushSize(): number;
  /** Base opacity of brush strokes, from 0 to 1. */
  getBrushOpacity(): number;
  /** The selected brush type with its current settings. */
  getBrush(): { readonly brush: BrushDefinition; readonly settings: BrushSettings };
  /** Seed for the randomized marks of the next stroke. */
  nextStrokeSeed(): number;
  getUsePenPressure(): boolean;
  getUsePenPressureOpacity(): boolean;
  getStabilizeStroke(): boolean;
  /** Rope length of the stroke stabilizer, in canvas pixels. */
  getStabilizeRadius(): number;
  getEraserSize(): number;
  /** Starts a gesture on the curves of the active layer; `null` (after reporting the reason) when editing is not possible. */
  beginCurveEdit(label: string): CurveEdit | null;
  /** Whether the active layer accepts curves. Reports the reason when it does not. */
  canEditCurves(): boolean;
  /** Curves of the active layer. */
  getCurves(): readonly BezierCurve[];
  /** Style for a new curve: the options of the Bézier tool plus the drawing color. */
  newCurveStyle(): CurveStyle;
  createId(): string;
  /** Converts a distance in screen pixels to canvas pixels at the current zoom. */
  toCanvasDistance(screenPixels: number): number;
  /** Publishes what the Bézier tool is working on, for the overlay and the options panel. */
  setCurveEditor(state: CurveEditorState): void;
  /** The active layer and its pixels; `null` (after reporting the reason) when the layer cannot be edited. */
  getActiveLayerPixels(): { readonly layerId: string; readonly drawing: DrawingData } | null;
  getSelectionOptions(): SelectionOptions;
  /** Publishes the rectangle of the Selection Tool for the overlay; `null` when there is none. */
  setSelection(state: SelectionState | null): void;
  reportError(message: string): void;
}

export interface EditorTool {
  readonly id: ToolType;
  readonly name: string;
  activate(): void;
  deactivate(): void;
  pointerDown(event: ToolPointerEvent): void;
  pointerMove(event: ToolPointerEvent): void;
  pointerUp(event: ToolPointerEvent): void;
  /** Optional second click of a double-click, after the pointer events of both clicks. */
  doubleClick?(event: ToolPointerEvent): void;
  /** The gesture was interrupted (lost capture, window blur...). Work done so far is kept. */
  pointerCancel(): void;
}

export function toPoint(event: ToolPointerEvent): Point {
  return { x: event.x, y: event.y };
}
