import type { Command, CommandFocus } from '../history/history';
import type { BezierCurve } from './curve';

/** Callbacks a curve edit needs from the engine that owns it. */
export interface CurveEditHost {
  /** Replaces the curves of the layer named by `focus` (not recorded in the history). */
  setCurves(focus: CommandFocus, curves: readonly BezierCurve[]): void;
  record(command: Command): void;
}

/** Undoable replacement of the curves of one layer. */
class CurvesCommand implements Command {
  constructor(
    readonly label: string,
    readonly focus: CommandFocus,
    private readonly before: readonly BezierCurve[],
    private readonly after: readonly BezierCurve[],
    private readonly host: CurveEditHost
  ) {}

  execute(): void {
    this.host.setCurves(this.focus, this.after);
  }

  undo(): void {
    this.host.setCurves(this.focus, this.before);
  }
}

/**
 * One gesture on the curves of a layer (creating a curve, dragging an anchor, ...).
 * The layer shows every `update` immediately; the history receives a single entry
 * when the gesture is committed, and nothing when it is cancelled.
 */
export class CurveEdit {
  private current: readonly BezierCurve[];
  private finished = false;

  constructor(
    private readonly label: string,
    private readonly focus: CommandFocus,
    private readonly original: readonly BezierCurve[],
    private readonly host: CurveEditHost
  ) {
    this.current = original;
  }

  update(curves: readonly BezierCurve[]): void {
    if (this.finished) {
      return;
    }
    this.current = curves;
    this.host.setCurves(this.focus, curves);
  }

  /** Records the gesture for undo. Returns `false` when nothing changed. */
  commit(): boolean {
    if (this.finished) {
      return false;
    }
    this.finished = true;
    if (this.current === this.original) {
      return false;
    }
    this.host.record(new CurvesCommand(this.label, this.focus, this.original, this.current, this.host));
    return true;
  }

  /** Puts the curves back as they were without touching the history. */
  cancel(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    if (this.current !== this.original) {
      this.host.setCurves(this.focus, this.original);
    }
  }
}
