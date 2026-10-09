import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { EditorSession, EditorSnapshot } from '@editor/editorSession';
import { computeFitZoom, screenToCanvas, zoomFromWheel } from '@editor/viewport';
import { CanvasRenderer } from '../../services/canvasRenderer';

interface CanvasWorkspaceProps {
  session: EditorSession;
  snapshot: EditorSnapshot;
}

interface ZoomAnchor {
  canvasX: number;
  canvasY: number;
  clientX: number;
  clientY: number;
}

/** Area 4: the drawing surface. Displays the active frame and routes pointer input to the editor. */
export function CanvasWorkspace({ session, snapshot }: CanvasWorkspaceProps) {
  const { width, height } = snapshot;
  const { zoom, selectedTool, isPlaying, selection } = snapshot.state;
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const anchorRef = useRef<ZoomAnchor | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Rendering: the canvas always shows the active frame of the engine.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return undefined;
    }
    const renderer = new CanvasRenderer(canvas, width, height);
    rendererRef.current = renderer;
    const draw = () => renderer.render(session.engine.getActiveFrame());
    draw();
    const stopContent = session.engine.subscribeContent(draw);
    const stopStructure = session.engine.subscribe(draw);
    return () => {
      stopContent();
      stopStructure();
      rendererRef.current = null;
    };
  }, [session, width, height]);

  // Start with the whole canvas visible when it is larger than the workspace.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    const fit = computeFitZoom(viewport.clientWidth, viewport.clientHeight, width, height);
    if (fit < 100) {
      session.setZoom(fit);
    }
    // Only on first display of this session.
  }, [session]);

  // Ctrl + wheel zooms the canvas (not the page). Needs a non-passive listener to cancel the default.
  useEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (viewport === null || canvas === null) {
      return undefined;
    }
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const point = screenToCanvas(event.clientX, event.clientY, rect, width, height);
      const next = zoomFromWheel(zoomRef.current, event.deltaY);
      if (next === zoomRef.current) {
        return;
      }
      anchorRef.current =
        point === null ? null : { canvasX: point.x, canvasY: point.y, clientX: event.clientX, clientY: event.clientY };
      session.setZoom(next);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [session, width, height]);

  // Keep the point under the pointer fixed while zooming.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (anchor === null || viewport === null || canvas === null) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) {
      return;
    }
    const currentX = rect.left + (anchor.canvasX / width) * rect.width;
    const currentY = rect.top + (anchor.canvasY / height) * rect.height;
    viewport.scrollLeft += currentX - anchor.clientX;
    viewport.scrollTop += currentY - anchor.clientY;
  }, [zoom, width, height]);

  function toEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return null;
    }
    const point = screenToCanvas(event.clientX, event.clientY, canvas.getBoundingClientRect(), width, height);
    if (point === null) {
      return null;
    }
    return { x: point.x, y: point.y, pointerId: event.pointerId, pressure: event.pressure, buttons: event.buttons };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || isPlaying) {
      return;
    }
    const toolEvent = toEvent(event);
    if (toolEvent === null) {
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an optimization for strokes leaving the canvas; drawing works without it.
    }
    session.pointerDown(toolEvent);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const toolEvent = toEvent(event);
    if (toolEvent !== null) {
      session.pointerMove(toolEvent);
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const toolEvent = toEvent(event);
    if (toolEvent !== null) {
      session.pointerUp(toolEvent);
    } else {
      session.pointerCancel(event.pointerId);
    }
  }

  const scale = zoom / 100;

  return (
    <div ref={viewportRef} className="canvas-viewport" data-testid="canvas-viewport">
      <div
        className="canvas-frame"
        style={{ width: width * scale, height: height * scale }}
        data-tool={selectedTool}
        data-playing={isPlaying ? 'true' : 'false'}
      >
        <canvas
          ref={canvasRef}
          className="drawing-canvas"
          aria-label={`Drawing canvas, ${width} by ${height} pixels`}
          data-testid="drawing-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(event) => session.pointerCancel(event.pointerId)}
          onLostPointerCapture={(event) => session.pointerCancel(event.pointerId)}
          onContextMenu={(event) => event.preventDefault()}
        />
        {selection !== null && (
          <div
            className="selection-overlay"
            data-testid="selection-overlay"
            style={{
              left: `${(selection.x / width) * 100}%`,
              top: `${(selection.y / height) * 100}%`,
              width: `${(selection.width / width) * 100}%`,
              height: `${(selection.height / height) * 100}%`
            }}
          />
        )}
      </div>
    </div>
  );
}
