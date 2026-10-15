import {
  CURVE_DOUBLE_CLICK_SCREEN_PX,
  CURVE_DRAG_SCREEN_PX,
  CURVE_HANDLE_HIT_SCREEN_PX,
  CURVE_HIT_SCREEN_PX,
  MIN_ANCHOR_DISTANCE
} from '../constants';
import { CURVE_LIMITS } from '@shared/types/curves';
import { hasHandle, type AnchorType, type BezierCurve } from '../curves/curve';
import type { CurveEdit } from '../curves/curveEdit';
import {
  addSegmentHandles,
  appendAnchor,
  canRemoveAnchor,
  cornerAnchor,
  createAnchor,
  insertAnchor,
  isDrawableCurve,
  moveAnchor,
  moveCurve,
  moveHandle,
  removeAnchor,
  retypeAnchor,
  smoothAnchor
} from '../curves/editing';
import { distance, nearestOnPath } from '../curves/geometry';
import { paintCurveStroke } from '../curves/render';
import type { Point, ToolType } from '../model';
import { toPoint, type EditorTool, type ToolContext, type ToolPointerEvent } from './tool';

type HandleSide = 'in' | 'out';

/** What a press landed on. */
type Control = { readonly kind: 'anchor'; readonly index: number } | { readonly kind: 'handle'; readonly index: number; readonly side: HandleSide };
type Grab = { readonly kind: 'curve' } | Control;

type Gesture =
  /** Dragging out the handles of the anchor that was just placed on the draft. */
  | { readonly kind: 'newHandle'; readonly index: number; readonly origin: Point; dragged: boolean }
  /** Moving a curve, an anchor or a handle of a curve that is on the layer. */
  | { readonly kind: 'edit'; readonly grab: Grab; readonly edit: CurveEdit; readonly base: BezierCurve; readonly origin: Point; dragged: boolean }
  /** Moving an anchor or a handle of the pending path; nothing is recorded until it is confirmed. */
  | { readonly kind: 'draft'; readonly grab: Control; readonly base: BezierCurve; readonly origin: Point; dragged: boolean };

function replaceCurve(curves: readonly BezierCurve[], curve: BezierCurve): BezierCurve[] {
  return curves.map((existing) => (existing.id === curve.id ? curve : existing));
}

/**
 * Draws and edits cubic Bézier paths (HU_00010). A press on empty canvas starts a path and
 * every further press adds an anchor (dragging shapes its handles); Enter, a double-click or
 * leaving the tool finishes it. Presses on an existing curve select it, and its anchors,
 * handles and body can then be dragged. Each completed gesture is one undo step.
 */
export class BezierTool implements EditorTool {
  readonly id: ToolType = 'bezier';
  readonly name = 'Bézier Curve';

  private draft: BezierCurve | null = null;
  private selectedId: string | null = null;
  private selectedAnchor: number | null = null;
  private gesture: Gesture | null = null;

  constructor(private readonly context: ToolContext) {}

  activate(): void {}

  deactivate(): void {
    this.endGesture();
    this.finish();
    this.selectedId = null;
    this.selectedAnchor = null;
    this.publish();
  }

  pointerDown(event: ToolPointerEvent): void {
    const point = toPoint(event);
    if (this.draft !== null) {
      // A press on an anchor or handle of the pending path edits it; only a press elsewhere adds an anchor.
      const grab = this.pickControl(this.draft, point);
      if (grab === null) {
        this.extendDraft(point);
      } else {
        this.selectedAnchor = grab.index;
        this.gesture = { kind: 'draft', grab, base: this.draft, origin: point, dragged: false };
        this.publish();
      }
      return;
    }
    const selected = this.selectedCurve();
    const control = selected === null ? null : this.pickControl(selected, point);
    if (selected !== null && control !== null) {
      this.select(selected.id, control.index);
      this.beginEdit(selected, control, point);
      return;
    }
    const hit = this.pickCurve(point);
    if (hit !== null) {
      this.select(hit.id, null);
      this.beginEdit(hit, { kind: 'curve' }, point);
      return;
    }
    this.startDraft(point);
  }

  pointerMove(event: ToolPointerEvent): void {
    const gesture = this.gesture;
    if (gesture === null) {
      return;
    }
    const point = toPoint(event);
    if (!gesture.dragged && distance(point, gesture.origin) < this.context.toCanvasDistance(CURVE_DRAG_SCREEN_PX)) {
      return;
    }
    gesture.dragged = true;
    if (gesture.kind === 'newHandle') {
      if (this.draft !== null) {
        this.draft = moveHandle(retypeAnchor(this.draft, gesture.index, 'smooth'), gesture.index, 'out', point);
        this.publish();
      }
      return;
    }
    const moved = this.applyGrab(gesture.base, gesture.grab, point.x - gesture.origin.x, point.y - gesture.origin.y);
    if (gesture.kind === 'draft') {
      this.draft = moved;
      this.publish();
      return;
    }
    gesture.edit.update(replaceCurve(this.context.getCurves(), moved));
  }

  pointerUp(event: ToolPointerEvent): void {
    this.pointerMove(event);
    this.endGesture();
  }

  pointerCancel(): void {
    this.endGesture();
  }

  doubleClick(event: ToolPointerEvent): void {
    if (this.draft !== null) {
      this.finish();
      return;
    }
    const curve = this.selectedCurve();
    if (curve === null) {
      return;
    }
    const point = toPoint(event);
    const anchor = this.pickAnchor(curve, point);
    if (anchor !== null) {
      const toggled = curve.anchors[anchor]?.type === 'smooth' ? cornerAnchor(curve, anchor) : smoothAnchor(curve, anchor);
      this.commitCurve('Change anchor type', toggled);
      this.select(curve.id, anchor);
      return;
    }
    const near = nearestOnPath(curve.anchors, point, this.hitTolerance(curve));
    const inserted = near === null ? null : insertAnchor(curve, near.segment, near.t);
    if (inserted !== null && this.guardAnchorCount(curve) && this.commitCurve('Add anchor', inserted.curve)) {
      this.select(curve.id, inserted.index);
    }
  }

  // ---- Actions (keyboard shortcuts and the options panel) ------------------

  /** Completes the path being drawn as a normal brush stroke on the active layer. A path that cannot be drawn is discarded. */
  finish(): void {
    const draft = this.draft;
    if (draft === null) {
      return;
    }
    this.draft = null;
    this.selectedAnchor = null;
    if (isDrawableCurve(draft) && this.context.canEditCurves()) {
      const stroke = this.context.beginStroke('Bézier curve');
      if (stroke !== null) {
        paintCurveStroke(draft, stroke);
        stroke.commit();
      }
    }
    this.publish();
  }

  /** Gives the pending path the current options of the tool (its random seed is kept). */
  restyleDraft(): void {
    if (this.draft === null) {
      return;
    }
    const style = { ...this.context.newCurveStyle(), seed: this.draft.style.seed };
    if (JSON.stringify(style) !== JSON.stringify(this.draft.style)) {
      this.draft = { ...this.draft, style };
      this.publish();
    }
  }

  /** Discards the path being drawn; without one, clears the selection. */
  cancel(): void {
    this.draft = null;
    this.selectedId = null;
    this.selectedAnchor = null;
    this.publish();
  }

  /** Removes the selected anchor, or the whole curve when the path would not survive without it. */
  deleteSelection(): void {
    if (this.draft !== null) {
      const { anchors } = this.draft;
      if (anchors.length > 1) {
        const index = Math.min(this.selectedAnchor ?? anchors.length - 1, anchors.length - 1);
        this.draft = { ...this.draft, anchors: anchors.filter((_, position) => position !== index) };
        this.selectedAnchor = Math.min(index, anchors.length - 2);
        this.publish();
      } else {
        this.cancel();
      }
      return;
    }
    const curve = this.selectedCurve();
    if (curve !== null && this.selectedAnchor !== null && canRemoveAnchor(curve)) {
      this.removeSelectedAnchor();
    } else {
      this.deleteSelectedCurve();
    }
  }

  removeSelectedAnchor(): void {
    const curve = this.selectedCurve();
    const reduced = curve !== null && this.selectedAnchor !== null ? removeAnchor(curve, this.selectedAnchor) : null;
    if (reduced !== null && this.commitCurve('Remove anchor', reduced)) {
      this.select(reduced.id, null);
    }
  }

  deleteSelectedCurve(): void {
    const curve = this.selectedCurve();
    const edit = curve === null ? null : this.context.beginCurveEdit('Delete curve');
    if (curve === null || edit === null) {
      return;
    }
    edit.update(this.context.getCurves().filter((existing) => existing.id !== curve.id));
    edit.commit();
    this.select(null, null);
  }

  setAnchorType(type: AnchorType): void {
    const curve = this.selectedCurve();
    if (curve === null || this.selectedAnchor === null) {
      return;
    }
    this.commitCurve('Change anchor type', type === 'smooth' ? smoothAnchor(curve, this.selectedAnchor) : cornerAnchor(curve, this.selectedAnchor));
  }

  /** Gives the selected curve the current options of the tool (its random seed is kept). */
  applyStyle(): void {
    const curve = this.selectedCurve();
    if (curve === null) {
      return;
    }
    const style = { ...this.context.newCurveStyle(), seed: curve.style.seed };
    if (JSON.stringify(style) !== JSON.stringify(curve.style)) {
      this.commitCurve('Change curve style', { ...curve, style });
    }
  }

  // ---- Internals ---------------------------------------------------------

  private selectedCurve(): BezierCurve | null {
    return this.selectedId === null ? null : (this.context.getCurves().find((curve) => curve.id === this.selectedId) ?? null);
  }

  private select(curveId: string | null, anchor: number | null): void {
    this.selectedId = curveId;
    this.selectedAnchor = anchor;
    this.publish();
  }

  private publish(): void {
    this.context.setCurveEditor({
      draft: this.draft,
      selectedCurveId: this.draft === null ? this.selectedId : null,
      selectedAnchor: this.selectedAnchor
    });
  }

  private startDraft(point: Point): void {
    if (!this.context.canEditCurves()) {
      return;
    }
    this.draft = { id: this.context.createId(), anchors: [createAnchor(point)], style: this.context.newCurveStyle() };
    this.selectedId = null;
    this.selectedAnchor = 0;
    this.gesture = { kind: 'newHandle', index: 0, origin: point, dragged: false };
    this.publish();
  }

  private extendDraft(point: Point): void {
    const draft = this.draft as BezierCurve;
    const last = draft.anchors[draft.anchors.length - 1] as Point;
    // A double-click presses twice at the same place: the second press must not add an anchor.
    if (distance(point, last) < Math.max(MIN_ANCHOR_DISTANCE, this.context.toCanvasDistance(CURVE_DOUBLE_CLICK_SCREEN_PX))) {
      return;
    }
    if (draft.anchors.length >= CURVE_LIMITS.maxAnchorsPerCurve) {
      this.context.reportError(`A curve can have at most ${CURVE_LIMITS.maxAnchorsPerCurve} anchors.`);
      return;
    }
    this.draft = addSegmentHandles(appendAnchor(draft, createAnchor(point)), draft.anchors.length);
    this.selectedAnchor = draft.anchors.length;
    this.gesture = { kind: 'newHandle', index: draft.anchors.length, origin: point, dragged: false };
    this.publish();
  }

  private beginEdit(curve: BezierCurve, grab: Grab, point: Point): void {
    const edit = this.context.beginCurveEdit(grab.kind === 'curve' ? 'Move curve' : grab.kind === 'anchor' ? 'Move anchor' : 'Adjust handle');
    if (edit !== null) {
      this.gesture = { kind: 'edit', grab, edit, base: curve, origin: point, dragged: false };
    }
  }

  /** Ends the gesture: a drag is committed as one undo step, a plain press changes nothing. */
  private endGesture(): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture?.kind === 'edit') {
      if (gesture.dragged) {
        gesture.edit.commit();
      } else {
        gesture.edit.cancel();
      }
    }
  }

  private commitCurve(label: string, curve: BezierCurve): boolean {
    const edit = this.context.beginCurveEdit(label);
    if (edit === null) {
      return false;
    }
    edit.update(replaceCurve(this.context.getCurves(), curve));
    return edit.commit();
  }

  private applyGrab(base: BezierCurve, grab: Grab, dx: number, dy: number): BezierCurve {
    if (grab.kind === 'curve') {
      return moveCurve(base, dx, dy);
    }
    const anchor = base.anchors[grab.index] as BezierCurve['anchors'][number];
    if (grab.kind === 'anchor') {
      return moveAnchor(base, grab.index, { x: anchor.x + dx, y: anchor.y + dy });
    }
    const handle = grab.side === 'in' ? anchor.handleIn : anchor.handleOut;
    return moveHandle(base, grab.index, grab.side, { x: anchor.x + handle.x + dx, y: anchor.y + handle.y + dy });
  }

  private hitTolerance(curve: BezierCurve): number {
    return curve.style.size / 2 + this.context.toCanvasDistance(CURVE_HIT_SCREEN_PX);
  }

  /** The topmost curve under the point. */
  private pickCurve(point: Point): BezierCurve | null {
    const curves = this.context.getCurves();
    for (let index = curves.length - 1; index >= 0; index -= 1) {
      const curve = curves[index] as BezierCurve;
      if (nearestOnPath(curve.anchors, point, this.hitTolerance(curve)) !== null) {
        return curve;
      }
    }
    return null;
  }

  private pickAnchor(curve: BezierCurve, point: Point): number | null {
    let best: number | null = null;
    let bestDistance = this.context.toCanvasDistance(CURVE_HANDLE_HIT_SCREEN_PX);
    for (const [index, anchor] of curve.anchors.entries()) {
      const separation = distance(point, anchor);
      if (separation <= bestDistance) {
        best = index;
        bestDistance = separation;
      }
    }
    return best;
  }

  /** The anchor or handle of the curve under the point (anchors win over handles). */
  private pickControl(curve: BezierCurve, point: Point): Control | null {
    const anchor = this.pickAnchor(curve, point);
    if (anchor !== null) {
      return { kind: 'anchor', index: anchor };
    }
    let best: Control | null = null;
    let bestDistance = this.context.toCanvasDistance(CURVE_HANDLE_HIT_SCREEN_PX);
    for (const [index, owner] of curve.anchors.entries()) {
      for (const side of ['in', 'out'] as const) {
        const handle = side === 'in' ? owner.handleIn : owner.handleOut;
        const separation = hasHandle(handle) ? distance(point, { x: owner.x + handle.x, y: owner.y + handle.y }) : Infinity;
        if (separation <= bestDistance) {
          best = { kind: 'handle', index, side };
          bestDistance = separation;
        }
      }
    }
    return best;
  }

  private guardAnchorCount(curve: BezierCurve): boolean {
    if (curve.anchors.length < CURVE_LIMITS.maxAnchorsPerCurve) {
      return true;
    }
    this.context.reportError(`A curve can have at most ${CURVE_LIMITS.maxAnchorsPerCurve} anchors.`);
    return false;
  }
}

export function createBezierTool(context: ToolContext): BezierTool {
  return new BezierTool(context);
}
