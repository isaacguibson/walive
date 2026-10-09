import type { Command, CommandFocus } from '../history/history';
import type { DrawingData, Rect } from '../model';
import { extractRegion, markDirty, readRegion, unionRect, writeRegion } from './raster';

/** Callbacks a stroke needs from the engine that owns it. */
export interface StrokeHost {
  record(command: Command): void;
  contentChanged(): void;
}

/** Undoable change of a rectangular pixel region of one drawing. */
class PatchCommand implements Command {
  constructor(
    readonly label: string,
    readonly focus: CommandFocus,
    private readonly drawing: DrawingData,
    private readonly rect: Rect,
    private readonly before: Uint8ClampedArray,
    private readonly after: Uint8ClampedArray,
    private readonly contentChanged: () => void
  ) {}

  execute(): void {
    this.apply(this.after);
  }

  undo(): void {
    this.apply(this.before);
  }

  private apply(pixels: Uint8ClampedArray): void {
    writeRegion(this.drawing, this.rect, pixels);
    markDirty(this.drawing, this.rect);
    this.contentChanged();
  }
}

/**
 * One continuous drawing gesture (a brush stroke, one fill, ...) on one drawing.
 * Pixels are edited live; on `commit` a compact before/after patch of the
 * touched region is recorded in the history. Nothing is written to the history
 * (or to disk) while the pointer moves.
 */
export class StrokeSession {
  private readonly snapshot: Uint8ClampedArray | null;
  private bounds: Rect | null = null;
  private finished = false;

  constructor(
    private readonly label: string,
    private readonly focus: CommandFocus,
    private readonly drawing: DrawingData,
    private readonly host: StrokeHost
  ) {
    this.snapshot = drawing.data === null ? null : new Uint8ClampedArray(drawing.data);
  }

  /** Runs a pixel operation on the drawing. The operation returns the rectangle it changed, if any. */
  apply(operation: (drawing: DrawingData) => Rect | null): void {
    if (this.finished) {
      return;
    }
    const changed = operation(this.drawing);
    if (changed === null) {
      return;
    }
    markDirty(this.drawing, changed);
    this.bounds = this.bounds === null ? changed : unionRect(this.bounds, changed);
    this.host.contentChanged();
  }

  /** Ends the gesture and records it for undo. Returns `false` when nothing changed. */
  commit(): boolean {
    if (this.finished) {
      return false;
    }
    this.finished = true;
    if (this.bounds === null) {
      return false;
    }
    const before = extractRegion(this.snapshot, this.drawing.width, this.bounds);
    const after = readRegion(this.drawing, this.bounds);
    this.host.record(
      new PatchCommand(this.label, this.focus, this.drawing, this.bounds, before, after, () =>
        this.host.contentChanged()
      )
    );
    return true;
  }

  /** Reverts everything the gesture changed without touching the history. */
  cancel(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    if (this.bounds === null) {
      return;
    }
    writeRegion(this.drawing, this.bounds, extractRegion(this.snapshot, this.drawing.width, this.bounds));
    markDirty(this.drawing, this.bounds);
    this.host.contentChanged();
  }
}
