import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutAPI } from '@shared/types/api';
import {
  DEFAULT_TOOL_WINDOW_LAYOUT,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  sanitizeToolWindowLayout,
  type ToolWindowId,
  type ToolWindowLayout
} from '@shared/types/layout';

export { MAX_PANEL_WIDTH, MIN_PANEL_WIDTH };
export type { ToolWindowId, ToolWindowLayout };

// The editor is rebuilt for every scene; this keeps the layout across those rebuilds.
let lastLayout: ToolWindowLayout = DEFAULT_TOOL_WINDOW_LAYOUT;

/** Visibility and width of the right-side tool windows, persisted through the main process. */
export function useToolWindows(api?: LayoutAPI) {
  const [layout, setLayout] = useState<ToolWindowLayout>(lastLayout);
  const loaded = useRef(api === undefined);
  const touched = useRef(false);

  useEffect(() => {
    if (api === undefined) {
      return undefined;
    }
    let active = true;
    void api.getLayout().then((result) => {
      if (active && result.ok && !touched.current) {
        setLayout(sanitizeToolWindowLayout(result.value));
      }
      loaded.current = true;
    });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    lastLayout = layout;
    if (api !== undefined && touched.current && loaded.current) {
      void api.saveLayout(layout);
    }
  }, [api, layout]);

  const update = useCallback((change: (current: ToolWindowLayout) => ToolWindowLayout) => {
    touched.current = true;
    setLayout(change);
  }, []);

  const setMinimized = useCallback(
    (id: ToolWindowId, minimized: boolean) => update((current) => ({ ...current, minimized: { ...current.minimized, [id]: minimized } })),
    [update]
  );

  const toggle = useCallback(
    (id: ToolWindowId) => update((current) => ({ ...current, minimized: { ...current.minimized, [id]: !current.minimized[id] } })),
    [update]
  );

  const setWidth = useCallback(
    (key: 'inspector' | 'chat', width: number) => update((current) => ({ ...current, widths: { ...current.widths, [key]: Math.min(Math.max(width, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH) } })),
    [update]
  );

  return { layout, setMinimized, toggle, setWidth };
}
