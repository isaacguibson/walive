import type { DrawingData, Point, Rect, Rgb, ToolType } from '../model';

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
  apply(operation: (drawing: DrawingData) => Rect | null): void;
  commit(): boolean;
  cancel(): void;
}

export interface ToolContext {
  readonly width: number;
  readonly height: number;
  /** Starts a gesture on the active layer; `null` (after reporting the reason) when drawing is not possible. */
  beginStroke(label: string): StrokeHandle | null;
  getColor(): Rgb;
  setColor(color: Rgb): void;
  getBrushSize(): number;
  getUsePenPressure(): boolean;
  getStabilizeStroke(): boolean;
  /** Rope length of the stroke stabilizer, in canvas pixels. */
  getStabilizeRadius(): number;
  getEraserSize(): number;
  /** Color of the visible canvas at a pixel; `null` when transparent. */
  pickColor(x: number, y: number): Rgb | null;
  setSelection(selection: Rect | null): void;
}

export interface EditorTool {
  readonly id: ToolType;
  readonly name: string;
  activate(): void;
  deactivate(): void;
  pointerDown(event: ToolPointerEvent): void;
  pointerMove(event: ToolPointerEvent): void;
  pointerUp(event: ToolPointerEvent): void;
  /** The gesture was interrupted (lost capture, window blur...). Work done so far is kept. */
  pointerCancel(): void;
}

export function toPoint(event: ToolPointerEvent): Point {
  return { x: event.x, y: event.y };
}
