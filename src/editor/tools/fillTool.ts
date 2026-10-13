import { floodFill } from '../drawing/floodFill';
import type { EditorTool, ToolContext } from './tool';

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
