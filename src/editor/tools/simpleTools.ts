import { floodFill } from '../drawing/floodFill';
import { clipRect } from '../drawing/raster';
import type { Rect } from '../model';
import type { EditorTool, ToolContext, ToolPointerEvent } from './tool';

/** Fills the contiguous area under the pointer on the active layer with the active color. */
export function createFillTool(context: ToolContext): EditorTool {
  return {
    id: 'fill',
    name: 'Fill Tool',
    activate() {},
    deactivate() {},
    pointerDown(event) {
      const stroke = context.beginStroke('Fill');
      if (stroke === null) {
        return;
      }
      const color = context.getColor();
      stroke.apply((drawing) => floodFill(drawing, event.x, event.y, color));
      stroke.commit();
    },
    pointerMove() {},
    pointerUp() {},
    pointerCancel() {}
  };
}

/** Makes the color of the visible canvas under the pointer the active color. */
export function createEyedropperTool(context: ToolContext): EditorTool {
  let picking = false;
  const pick = (event: ToolPointerEvent): void => {
    const x = Math.floor(event.x);
    const y = Math.floor(event.y);
    if (x < 0 || y < 0 || x >= context.width || y >= context.height) {
      return;
    }
    const color = context.pickColor(x, y);
    if (color !== null) {
      context.setColor(color);
    }
  };
  return {
    id: 'eyedropper',
    name: 'Color Picker',
    activate() {},
    deactivate() {
      picking = false;
    },
    pointerDown(event) {
      picking = true;
      pick(event);
    },
    pointerMove(event) {
      if (picking) {
        pick(event);
      }
    },
    pointerUp(event) {
      if (picking) {
        pick(event);
      }
      picking = false;
    },
    pointerCancel() {
      picking = false;
    }
  };
}

/** Rectangular selection. It only identifies an area; transformations belong to later HUs. */
export function createSelectionTool(context: ToolContext): EditorTool {
  let anchor: { x: number; y: number } | null = null;

  const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, Math.round(value)));
  const rectTo = (event: ToolPointerEvent): Rect | null => {
    if (anchor === null) {
      return null;
    }
    const x = clamp(event.x, context.width);
    const y = clamp(event.y, context.height);
    return clipRect(
      { x: Math.min(anchor.x, x), y: Math.min(anchor.y, y), width: Math.abs(x - anchor.x), height: Math.abs(y - anchor.y) },
      context.width,
      context.height
    );
  };

  return {
    id: 'selection',
    name: 'Selection Tool',
    activate() {},
    deactivate() {
      anchor = null;
    },
    pointerDown(event) {
      anchor = { x: clamp(event.x, context.width), y: clamp(event.y, context.height) };
      context.setSelection(null);
    },
    pointerMove(event) {
      if (anchor !== null) {
        context.setSelection(rectTo(event));
      }
    },
    pointerUp(event) {
      if (anchor !== null) {
        context.setSelection(rectTo(event));
      }
      anchor = null;
    },
    pointerCancel() {
      anchor = null;
    }
  };
}
