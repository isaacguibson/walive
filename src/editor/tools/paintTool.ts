import { paintSegment, type StrokeMode } from '../drawing/brush';
import type { Point, ToolType } from '../model';
import { toPoint, type EditorTool, type StrokeHandle, type ToolContext, type ToolPointerEvent } from './tool';

interface PaintToolOptions {
  id: ToolType;
  name: string;
  /** Label of the undo entry. */
  label: string;
  mode(): StrokeMode;
  size(): number;
}

/** Shared behavior of the Brush and the Eraser: continuous strokes on the active layer. */
export class PaintTool implements EditorTool {
  readonly id: ToolType;
  readonly name: string;
  private stroke: StrokeHandle | null = null;
  private last: Point | null = null;

  constructor(
    private readonly context: ToolContext,
    private readonly options: PaintToolOptions
  ) {
    this.id = options.id;
    this.name = options.name;
  }

  activate(): void {}

  deactivate(): void {
    this.finish();
  }

  pointerDown(event: ToolPointerEvent): void {
    this.finish();
    this.stroke = this.context.beginStroke(this.options.label);
    if (this.stroke === null) {
      return;
    }
    this.last = toPoint(event);
    this.paint(this.last, this.last);
  }

  pointerMove(event: ToolPointerEvent): void {
    if (this.stroke === null || this.last === null) {
      return;
    }
    const next = toPoint(event);
    this.paint(this.last, next);
    this.last = next;
  }

  pointerUp(event: ToolPointerEvent): void {
    this.pointerMove(event);
    this.finish();
  }

  pointerCancel(): void {
    this.finish();
  }

  private paint(from: Point, to: Point): void {
    const { mode, size } = this.options;
    this.stroke?.apply((drawing) => paintSegment(drawing, from, to, size(), mode()));
  }

  private finish(): void {
    this.stroke?.commit();
    this.stroke = null;
    this.last = null;
  }
}

export function createBrushTool(context: ToolContext): PaintTool {
  return new PaintTool(context, {
    id: 'brush',
    name: 'Brush',
    label: 'Brush stroke',
    mode: () => ({ kind: 'paint', color: context.getColor() }),
    size: () => context.getBrushSize()
  });
}

export function createEraserTool(context: ToolContext): PaintTool {
  return new PaintTool(context, {
    id: 'eraser',
    name: 'Eraser',
    label: 'Erase',
    mode: () => ({ kind: 'erase' }),
    size: () => context.getEraserSize()
  });
}
