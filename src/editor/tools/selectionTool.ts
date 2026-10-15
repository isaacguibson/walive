import { SELECTION_HANDLE_HIT_SCREEN_PX, SELECTION_ROTATE_HANDLE_SCREEN_PX } from '../constants';
import { angleOf, normalizeDegrees } from '../angles';
import { clearRegion, clipRect, compositeBlock, extractRegion, unionRect } from '../drawing/raster';
import type { Point, Rect, SelectionPreview } from '../model';
import type { PlacementHandle } from '../placement';
import { FloatingSelection } from '../selection/floatingSelection';
import { hitTest, moveRect, rectFromPoints, resizeRotatedRect } from '../selection/geometry';
import { toPoint, type EditorTool, type ToolContext, type ToolPointerEvent } from './tool';

export interface SelectionTool extends EditorTool {
  /** Pixels to show over the layer while a transformation waits to be applied. */
  preview(): SelectionPreview | null;
  /** The pixels were moved or resized and the layer does not show it yet. */
  hasPending(): boolean;
  /** Applies a pending transformation as one history entry, then clears the selection. */
  settle(): void;
  /** Reverts a pending transformation (no history entry); without one, clears the selection. */
  cancel(): void;
}

type Gesture =
  | { kind: 'create'; anchor: Point }
  | { kind: 'move'; origin: Point; startRect: Rect }
  | { kind: 'resize'; handle: PlacementHandle; origin: Point; startRect: Rect }
  | { kind: 'rotate'; center: Point; startPointerAngle: number; startAngle: number };

/**
 * Selects a rectangle of the active layer and moves, resizes or rotates its pixels.
 *
 * Dragging on an empty area makes a selection and lifts its pixels; dragging inside moves them,
 * dragging a handle resizes them and dragging the round handle above the selection rotates them
 * around its center. Nothing changes on the layer until the transformation is
 * applied by pressing outside the selection (or by anything else that settles the editor), which
 * records a single history entry. A press outside only confirms: it never starts a new selection.
 */
export function createSelectionTool(context: ToolContext): SelectionTool {
  let selection: FloatingSelection | null = null;
  /** Rectangle being dragged out, before there are pixels to lift. */
  let marquee: Rect | null = null;
  let gesture: Gesture | null = null;

  function publish(): void {
    if (selection !== null) {
      context.setSelection({ rect: selection.rect, creating: false, pending: selection.isPending, angle: selection.angle });
    } else if (marquee !== null) {
      context.setSelection({ rect: marquee, creating: true, pending: false, angle: 0 });
    } else {
      context.setSelection(null);
    }
  }

  function clear(): void {
    selection = null;
    marquee = null;
    gesture = null;
    publish();
  }

  /** Writes the transformed pixels into the layer: removes the originals, then draws the result over what is left. */
  function apply(floating: FloatingSelection): void {
    const stroke = context.beginStroke('Transform selection');
    if (stroke === null) {
      return;
    }
    const pixels = floating.rendered(context.getSelectionOptions().resampling);
    stroke.apply((drawing) => {
      clearRegion(drawing, floating.source);
      // The destination may reach past the canvas; only the visible part is composited and changed.
      compositeBlock(drawing, pixels.pixels, pixels.rect);
      const visible = clipRect(pixels.rect, drawing.width, drawing.height);
      return visible === null ? floating.source : unionRect(floating.source, visible);
    });
    stroke.commit();
  }

  function settle(): void {
    if (selection?.isPending === true) {
      apply(selection);
    }
    clear();
  }

  function lift(rect: Rect): void {
    const target = context.getActiveLayerPixels();
    if (target === null) {
      return;
    }
    const pixels = extractRegion(target.drawing.data, target.drawing.width, rect);
    selection = new FloatingSelection(target.layerId, rect, pixels);
  }

  function update(event: ToolPointerEvent): void {
    if (gesture === null) {
      return;
    }
    const point = toPoint(event);
    if (gesture.kind === 'create') {
      marquee = rectFromPoints(gesture.anchor, point, context.width, context.height);
    } else if (selection !== null) {
      if (gesture.kind === 'rotate') {
        selection.angle = normalizeDegrees(gesture.startAngle + angleOf(gesture.center, point) - gesture.startPointerAngle);
      } else {
        const dx = point.x - gesture.origin.x;
        const dy = point.y - gesture.origin.y;
        selection.rect =
          gesture.kind === 'move'
            ? moveRect(gesture.startRect, dx, dy, context.width, context.height)
            : resizeRotatedRect(
                gesture.startRect,
                selection.angle,
                gesture.handle,
                dx,
                dy,
                context.getSelectionOptions().keepAspectRatio,
                context.width,
                context.height
              );
      }
    }
    publish();
  }

  return {
    id: 'select',
    name: 'Selection Tool',
    activate() {
      clear();
    },
    deactivate: settle,
    pointerDown(event) {
      const point = toPoint(event);
      if (selection === null) {
        if (context.getActiveLayerPixels() !== null) {
          gesture = { kind: 'create', anchor: point };
        }
        return;
      }
      const hit = hitTest(
        selection.rect,
        point,
        context.toCanvasDistance(SELECTION_HANDLE_HIT_SCREEN_PX),
        selection.angle,
        context.toCanvasDistance(SELECTION_ROTATE_HANDLE_SCREEN_PX)
      );
      if (hit.kind === 'outside') {
        settle();
      } else if (hit.kind === 'rotate') {
        const center = { x: selection.rect.x + selection.rect.width / 2, y: selection.rect.y + selection.rect.height / 2 };
        gesture = { kind: 'rotate', center, startPointerAngle: angleOf(center, point), startAngle: selection.angle };
      } else if (hit.kind === 'handle') {
        gesture = { kind: 'resize', handle: hit.handle, origin: point, startRect: selection.rect };
      } else {
        gesture = { kind: 'move', origin: point, startRect: selection.rect };
      }
    },
    pointerMove: update,
    pointerUp(event) {
      update(event);
      if (gesture?.kind === 'create') {
        const rect = marquee;
        marquee = null;
        if (rect !== null) {
          lift(rect);
        }
        publish();
      }
      gesture = null;
    },
    pointerCancel() {
      if (gesture?.kind === 'create') {
        marquee = null;
        publish();
      }
      gesture = null;
    },
    preview() {
      return selection?.preview(context.getSelectionOptions().resampling) ?? null;
    },
    hasPending() {
      return selection?.isPending ?? false;
    },
    settle,
    cancel() {
      gesture = null;
      if (selection !== null && selection.isTransformed) {
        selection.rect = selection.source;
        selection.angle = 0;
        publish();
      } else {
        clear();
      }
    }
  };
}
