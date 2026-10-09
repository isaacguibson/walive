import { paintVariableSegment, type StrokeMode } from '../drawing/brush';
import { StrokeStabilizer } from '../drawing/stabilizer';
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
  private lastSize = 1;
  private stabilizer: StrokeStabilizer | null = null;

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
    this.stabilizer =
      this.id === 'brush' && this.context.getStabilizeStroke() ? new StrokeStabilizer(this.context.getStabilizeRadius()) : null;
    this.last = this.stabilizer?.push(toPoint(event)) ?? toPoint(event);
    this.lastSize = this.effectiveSize(event);
    this.paint(this.last, this.last, this.lastSize, this.lastSize);
  }

  pointerMove(event: ToolPointerEvent): void {
    if (this.stroke === null || this.last === null) {
      return;
    }
    const next = this.stabilizer?.push(toPoint(event)) ?? toPoint(event);
    const nextSize = this.effectiveSize(event);
    this.paint(this.last, next, this.lastSize, nextSize);
    this.last = next;
    this.lastSize = nextSize;
  }

  pointerUp(event: ToolPointerEvent): void {
    // With stabilization the stroke ends where the rope left it, not at the release point.
    this.pointerMove(event);
    this.finish();
  }

  pointerCancel(): void {
    this.finish();
  }

  private paint(from: Point, to: Point, startSize: number, endSize: number): void {
    const { mode, size } = this.options;
    this.stroke?.apply((drawing) => paintVariableSegment(drawing, from, to, startSize || size(), endSize || size(), mode()));
  }

  private effectiveSize(event: ToolPointerEvent): number {
    const configuredSize = this.options.size();
    if (this.id !== 'brush' || !this.context.getUsePenPressure() || event.pointerType !== 'pen') {
      return configuredSize;
    }
    const pressure = event.pressure;
    if (pressure === undefined || !Number.isFinite(pressure) || pressure < 0 || pressure > 1) {
      return configuredSize;
    }
    return Math.max(1, configuredSize * pressure);
  }

  private finish(): void {
    this.stroke?.commit();
    this.stroke = null;
    this.last = null;
    this.lastSize = 1;
    this.stabilizer?.reset();
    this.stabilizer = null;
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
