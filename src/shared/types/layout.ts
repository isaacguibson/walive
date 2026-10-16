export type ToolWindowId = 'toolOptions' | 'ai';

/** Application UI preferences for the right-side tool windows. Not project data. */
export interface ToolWindowLayout {
  /** Whether each tool window is minimized to the tool-window bar. */
  minimized: Record<ToolWindowId, boolean>;
  /** Last width of each resizable tool window; kept while it is minimized. */
  widths: { inspector: number; chat: number };
}

export const MIN_PANEL_WIDTH = 180;
export const MAX_PANEL_WIDTH = 420;

export const DEFAULT_TOOL_WINDOW_LAYOUT: ToolWindowLayout = {
  minimized: { toolOptions: false, ai: false },
  widths: { inspector: 260, chat: 340 }
};

function width(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH) : fallback;
}

/** Turns anything (missing, corrupted, outdated) into a valid layout. */
export function sanitizeToolWindowLayout(value: unknown): ToolWindowLayout {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_TOOL_WINDOW_LAYOUT;
  }
  const { minimized, widths } = value as { minimized?: Record<string, unknown> | null; widths?: Record<string, unknown> | null };
  return {
    minimized: { toolOptions: minimized?.toolOptions === true, ai: minimized?.ai === true },
    widths: {
      inspector: width(widths?.inspector, DEFAULT_TOOL_WINDOW_LAYOUT.widths.inspector),
      chat: width(widths?.chat, DEFAULT_TOOL_WINDOW_LAYOUT.widths.chat)
    }
  };
}
