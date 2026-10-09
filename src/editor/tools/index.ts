import type { ToolType } from '../model';
import { createBrushTool, createEraserTool } from './paintTool';
import { createEyedropperTool, createFillTool, createSelectionTool } from './simpleTools';
import type { EditorTool, ToolContext } from './tool';

export interface ToolDefinition {
  id: ToolType;
  /** Name shown as tooltip and accessible label. */
  name: string;
}

/** Tools in display order. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  { id: 'brush', name: 'Brush' },
  { id: 'eraser', name: 'Eraser' },
  { id: 'fill', name: 'Fill Tool' },
  { id: 'eyedropper', name: 'Color Picker' },
  { id: 'selection', name: 'Selection Tool' }
];

/** Registry of the available tools. New tools only need an entry here and in `TOOL_DEFINITIONS`. */
export function createTools(context: ToolContext): Record<ToolType, EditorTool> {
  return {
    brush: createBrushTool(context),
    eraser: createEraserTool(context),
    fill: createFillTool(context),
    eyedropper: createEyedropperTool(context),
    selection: createSelectionTool(context)
  };
}
