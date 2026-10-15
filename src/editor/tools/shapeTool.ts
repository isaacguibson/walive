import { isInEditingArea, lineEnds, pickLineEnd, shapeFromDrag, type Shape } from '../shapes/geometry';
import { paintShape } from '../shapes/render';
import { CURVE_DRAG_SCREEN_PX, CURVE_HANDLE_HIT_SCREEN_PX } from '../constants';
import { distance } from '../curves/geometry';
import type { Point, ToolType } from '../model';
import { toPoint, type EditorTool, type ToolContext, type ToolPointerEvent } from './tool';

export interface ShapeTool extends EditorTool {
  /** The shape waiting to be confirmed. */
  pending(): Shape | null;
  /** Paints the pending shape on the active layer as one undo step. Does nothing without one. */
  confirm(): void;
  /** Discards the pending shape without touching the project. Does nothing without one. */
  cancel(): void;
  /** Gives the pending shape the current options (its position is kept). */
  refresh(): void;
}

/** Dragging out a new shape, moving the pending one by the offset from the pointer to its center, or moving one end of a line. */
type Gesture = { kind: 'create'; anchor: Point; dragged: boolean } | { kind: 'move'; grab: Point } | { kind: 'end'; fixed: Point };

/**
 * Places a geometric shape. Pressing on the canvas and dragging sizes the shape between the press and the
 * pointer (a square, circle or triangle fills the square that the drag spans; a line runs from the press to
 * the pointer); a click without a drag places it centered there with the size of the tool options. The shape
 * then stays pending: dragging inside its editing area moves it, dragging an end of a line moves that end only,
 * and the options change it. Pressing outside
 * it, or Enter, paints it on the active layer as ordinary pixels; Escape discards it. The shape is never part
 * of the project while pending, and the tool cannot be left until it is resolved (the editor session enforces this).
 */
export function createShapeTool(context: ToolContext): ShapeTool {
  let pending: Shape | null = null;
  let gesture: Gesture | null = null;

  function publish(): void {
    context.setShapeEditor({ pending });
  }

  function confirm(): void {
    if (pending === null) {
      return;
    }
    const stroke = context.beginStroke('Shape');
    if (stroke === null) {
      return;
    }
    paintShape(pending, stroke);
    stroke.commit();
    pending = null;
    gesture = null;
    publish();
  }

  return {
    id: 'shape' satisfies ToolType,
    name: 'Geometric Shapes',
    activate() {},
    deactivate() {
      gesture = null;
    },
    pointerDown(event) {
      const point = toPoint(event);
      if (pending === null) {
        if (context.getActiveLayerPixels() !== null) {
          gesture = { kind: 'create', anchor: point, dragged: false };
        }
        return;
      }
      const tolerance = context.toCanvasDistance(CURVE_HANDLE_HIT_SCREEN_PX);
      const end = pickLineEnd(pending, point, tolerance);
      if (end !== null) {
        gesture = { kind: 'end', fixed: lineEnds(pending)[end === 0 ? 1 : 0] };
      } else if (isInEditingArea(pending, point, tolerance)) {
        gesture = { kind: 'move', grab: { x: pending.center.x - point.x, y: pending.center.y - point.y } };
      } else {
        // A press outside only confirms: it never starts a second shape.
        confirm();
      }
    },
    pointerMove(event) {
      if (gesture === null) {
        return;
      }
      const point = toPoint(event);
      if (gesture.kind === 'move') {
        if (pending !== null) {
          pending = { ...pending, center: { x: point.x + gesture.grab.x, y: point.y + gesture.grab.y } };
          publish();
        }
        return;
      }
      if (gesture.kind === 'end') {
        if (pending !== null) {
          pending = shapeFromDrag(pending, gesture.fixed, point);
          context.setShapeOptions({ size: pending.size, rotation: pending.rotation });
          publish();
        }
        return;
      }
      if (!gesture.dragged && distance(point, gesture.anchor) < context.toCanvasDistance(CURVE_DRAG_SCREEN_PX)) {
        return;
      }
      gesture.dragged = true;
      pending = shapeFromDrag(context.newShape(gesture.anchor), gesture.anchor, point);
      // The sliders show the size and angle the drag gave the shape.
      context.setShapeOptions({ size: pending.size, rotation: pending.rotation });
      publish();
    },
    pointerUp(event) {
      this.pointerMove(event);
      if (gesture?.kind === 'create' && !gesture.dragged) {
        pending = context.newShape(gesture.anchor);
        publish();
      }
      gesture = null;
    },
    pointerCancel() {
      gesture = null;
    },
    pending: () => pending,
    confirm,
    cancel() {
      gesture = null;
      if (pending !== null) {
        pending = null;
        publish();
      }
    },
    refresh() {
      if (pending !== null) {
        pending = context.newShape(pending.center);
        publish();
      }
    }
  };
}
