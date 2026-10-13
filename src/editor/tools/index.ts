import type { ToolType } from '../model';
import { createBezierTool, type BezierTool } from './bezierTool';
import { createBrushTool, createEraserTool } from './paintTool';
import { createFillTool } from './fillTool';
import type { EditorTool, ToolContext } from './tool';

export interface ToolDefinition {
  id: ToolType;
  /** Name shown as tooltip and accessible label. */
  name: string;
}

/** Tools in display order. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  { id: 'brush', name: 'Brush' },
  { id: 'bezier', name: 'Bézier Curve' },
  { id: 'eraser', name: 'Eraser' },
  { id: 'fill', name: 'Fill Tool' }
];

/** The tools by id; the Bézier tool is typed because the editor session also calls its actions. */
export type Tools = Record<ToolType, EditorTool> & { bezier: BezierTool };

/** Registry of the available tools. New tools only need an entry here and in `TOOL_DEFINITIONS`. */
export function createTools(context: ToolContext): Tools {
  return {
    brush: createBrushTool(context),
    bezier: createBezierTool(context),
    eraser: createEraserTool(context),
    fill: createFillTool(context)
  };
}
