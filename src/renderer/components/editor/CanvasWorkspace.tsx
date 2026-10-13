import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import type { EditorSession, EditorSnapshot } from '@editor/editorSession';
import type { Point, Rect } from '@editor/model';
import {
  fitPlacementRect,
  movePlacement,
  resizePlacement,
  SNAP_THRESHOLD_SCREEN_PX,
  type PlacementHandle
} from '@editor/placement';
import { computeFitZoom, screenToCanvas, zoomFromWheel } from '@editor/viewport';
import type { AssetsAPI } from '@shared/types/api';
import { ASSET_DRAG_MIME } from '@shared/types/assets';
import { CanvasRenderer } from '../../services/canvasRenderer';
import { CurveOverlay } from './CurveOverlay';

interface CanvasWorkspaceProps {
  session: EditorSession;
  snapshot: EditorSnapshot;
  assetsApi: AssetsAPI;
}

interface ZoomAnchor {
  canvasX: number;
  canvasY: number;
  clientX: number;
  clientY: number;
}

/**
 * An image dropped on the canvas that can still be moved and resized. The
 * original image is kept so every new size is drawn from it (resizing the
 * already rasterized layer would lose quality with each step).
 */
interface Placement {
  layerId: string;
  source: CanvasImageSource;
  rect: Rect;
}

interface PlacementGesture {
  handle: PlacementHandle | 'move';
  startX: number;
  startY: number;
  startRect: Rect;
}

const HANDLES: readonly PlacementHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_LABELS: Record<PlacementHandle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left'
};

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image could not be decoded.'));
    image.src = dataUrl;
  });
}

/** Browsers only expose the dragged data on drop; during dragover only the list of types is readable. */
function carriesAsset(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer !== null && Array.from(dataTransfer.types).includes(ASSET_DRAG_MIME);
}

function readAssetPayload(dataTransfer: DataTransfer): { assetId: string; assetName: string } | null {
  const raw = dataTransfer.getData(ASSET_DRAG_MIME);
  if (raw === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { assetId?: unknown; assetName?: unknown };
    if (typeof parsed.assetId === 'string' && typeof parsed.assetName === 'string') {
      return { assetId: parsed.assetId, assetName: parsed.assetName };
    }
  } catch {
    // Not one of our payloads.
  }
  return null;
}

function sourceSize(source: HTMLImageElement): { width: number; height: number } {
  // SVGs without intrinsic size report 0; fall back to something sensible instead of failing.
  return { width: source.naturalWidth || source.width || 256, height: source.naturalHeight || source.height || 256 };
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Area 4: the drawing surface. Displays the active frame and routes pointer input to the editor. */
export function CanvasWorkspace({ session, snapshot, assetsApi }: CanvasWorkspaceProps) {
  const { width, height } = snapshot;
  const { zoom, selectedTool, isPlaying, eraserSize } = snapshot.state;
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onionCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const anchorRef = useRef<ZoomAnchor | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const placementRef = useRef<Placement | null>(null);
  const gestureRef = useRef<PlacementGesture | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  /** Pointer position over the canvas, in canvas pixels; only tracked for the Eraser, whose preview follows it. */
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [placement, setPlacementState] = useState<Placement | null>(null);
  zoomRef.current = zoom;

  function setPlacement(next: Placement | null) {
    placementRef.current = next;
    setPlacementState(next);
  }

  function endPlacement() {
    gestureRef.current = null;
    if (placementRef.current !== null) {
      setPlacement(null);
    }
  }

  /** Draws the source image into `rect` on a canvas-sized surface and returns the pixels. */
  function rasterize(source: CanvasImageSource, rect: Rect): Uint8ClampedArray | null {
    if (scratchRef.current === null) {
      scratchRef.current = document.createElement('canvas');
    }
    const scratch = scratchRef.current;
    scratch.width = width;
    scratch.height = height;
    const context = scratch.getContext('2d');
    if (context === null) {
      return null;
    }
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
    return new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);
  }

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

  // The placement only makes sense while its layer is in the active frame (undo, frame changes, deletion).
  useEffect(() => {
    return session.engine.subscribe(() => {
      const current = placementRef.current;
      if (current !== null && !session.hasActiveFrameLayer(current.layerId)) {
        gestureRef.current = null;
        placementRef.current = null;
        setPlacementState(null);
      }
    });
  }, [session]);

  useEffect(() => {
    if (isPlaying && placementRef.current !== null) {
      gestureRef.current = null;
      placementRef.current = null;
      setPlacementState(null);
    }
  }, [isPlaying]);

  // Enter or Escape finish the placement (the image stays where it is; undo removes it).
  useEffect(() => {
    if (placement === null) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return;
      }
      event.preventDefault();
      gestureRef.current = null;
      placementRef.current = null;
      setPlacementState(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [placement === null]);

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
    return {
      x: point.x,
      y: point.y,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      pressure: event.pressure,
      buttons: event.buttons
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const isMiddleButton = event.button === 1 || event.buttons === 4;
    if (isMiddleButton) {
      event.preventDefault();
      setIsPanning(true);
      panRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: panOffset.x,
        originY: panOffset.y
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is an optimization for panning gestures leaving the canvas.
      }
      return;
    }
    if (event.button !== 0 || isPlaying) {
      return;
    }
    if (placementRef.current !== null) {
      // Clicking the canvas outside the image confirms the placement; that click does not draw.
      endPlacement();
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
    const pan = panRef.current;
    if (pan !== null && (event.button === 1 || event.buttons === 4)) {
      event.preventDefault();
      setPanOffset({
        x: pan.originX + (event.clientX - pan.startX),
        y: pan.originY + (event.clientY - pan.startY)
      });
      return;
    }
    const toolEvent = toEvent(event);
    if (selectedTool === 'eraser') {
      setHoverPoint(toolEvent === null ? null : { x: toolEvent.x, y: toolEvent.y });
    }
    if (toolEvent !== null) {
      session.pointerMove(toolEvent);
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (panRef.current !== null && (event.button === 1 || event.buttons === 0)) {
      panRef.current = null;
      setIsPanning(false);
      return;
    }
    const toolEvent = toEvent(event);
    if (toolEvent !== null) {
      session.pointerUp(toolEvent);
    } else {
      session.pointerCancel(event.pointerId);
    }
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const point =
      canvas === null ? null : screenToCanvas(event.clientX, event.clientY, canvas.getBoundingClientRect(), width, height);
    if (point !== null) {
      session.doubleClick({ ...point, pointerId: 0, buttons: event.buttons });
    }
  }

  // ---- Image placement ------------------------------------------------------

  function applyPlacementRect(current: Placement, rect: Rect) {
    if (sameRect(current.rect, rect)) {
      return;
    }
    const pixels = rasterize(current.source, rect);
    if (pixels === null || !session.updateLayerPixels(current.layerId, pixels)) {
      endPlacement();
      return;
    }
    setPlacement({ ...current, rect });
  }

  function onPlacementPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const handle = target.dataset.handle as PlacementGesture['handle'] | undefined;
    const current = placementRef.current;
    if (event.button !== 0 || handle === undefined || current === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    gestureRef.current = { handle, startX: event.clientX, startY: event.clientY, startRect: current.rect };
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Without capture the gesture still works while the pointer stays over the handle.
    }
  }

  function onPlacementPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    const current = placementRef.current;
    if (gesture === null || current === null) {
      return;
    }
    // Screen distances become canvas pixels by dividing by the zoom, including the snap distance.
    const scale = zoomRef.current / 100;
    const dx = (event.clientX - gesture.startX) / scale;
    const dy = (event.clientY - gesture.startY) / scale;
    const threshold = SNAP_THRESHOLD_SCREEN_PX / scale;
    const next =
      gesture.handle === 'move'
        ? movePlacement(gesture.startRect, dx, dy, width, height, threshold)
        : resizePlacement(gesture.startRect, gesture.handle, dx, dy, width, height, threshold, !event.shiftKey);
    applyPlacementRect(current, next);
  }

  function onPlacementPointerEnd() {
    gestureRef.current = null;
  }

  async function importDroppedAsset(event: DragEvent<HTMLDivElement>) {
    if (!carriesAsset(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    const payload = readAssetPayload(event.dataTransfer);
    if (payload === null || isPlaying) {
      return;
    }
    const canvas = canvasRef.current;
    const dropPoint =
      canvas === null ? null : screenToCanvas(event.clientX, event.clientY, canvas.getBoundingClientRect(), width, height);

    const result = await assetsApi.readAssetImage(payload.assetId);
    if (!result.ok) {
      session.reportError(result.error.message);
      return;
    }
    try {
      const image = await loadImage(result.value);
      const size = sourceSize(image);
      const inside =
        dropPoint !== null && dropPoint.x >= 0 && dropPoint.y >= 0 && dropPoint.x <= width && dropPoint.y <= height;
      const rect = fitPlacementRect(width, height, size.width, size.height, inside ? dropPoint : undefined);
      const pixels = rasterize(image, rect);
      if (pixels === null) {
        session.reportError('The image could not be placed on the canvas.');
        return;
      }
      endPlacement();
      const layerId = session.addLayerFromPixels(payload.assetName.replace(/\.[^.]+$/, ''), pixels);
      if (layerId !== null) {
        setPlacement({ layerId, source: image, rect });
      }
    } catch {
      session.reportError('The image could not be inserted into the canvas.');
    }
  }

  const scale = zoom / 100;
  const { draft, selectedCurveId, selectedAnchor } = snapshot.state.curveEditor;
  const overlayCurve =
    selectedTool !== 'bezier' || isPlaying
      ? null
      : (draft ?? snapshot.activeLayer.curves.find((curve) => curve.id === selectedCurveId) ?? null);
  const activeIndex = snapshot.frames.findIndex((frame) => frame.id === snapshot.activeFrame.id);
  const referenceId = snapshot.manualReferenceFrameId ?? snapshot.frames[activeIndex - 1]?.id ?? null;
  const displayedReferenceId =
    snapshot.onionEnabled && referenceId !== snapshot.activeFrame.id && snapshot.frames.some((frame) => frame.id === referenceId)
      ? referenceId
      : null;

  // The onion reference has its own read-only canvas underneath the editable surface.
  useEffect(() => {
    const canvas = onionCanvasRef.current;
    if (canvas === null || displayedReferenceId === null) {
      return undefined;
    }
    const renderer = new CanvasRenderer(canvas, width, height);
    const drawReference = () => {
      const frame = session.engine.getFrame(displayedReferenceId);
      if (frame !== null) {
        renderer.render(frame);
      }
    };
    drawReference();
    const stopStructure = session.engine.subscribe(drawReference);
    const stopContent = session.engine.subscribeContent(drawReference);
    return () => {
      stopStructure();
      stopContent();
    };
  }, [session, width, height, displayedReferenceId]);

  return (
    <div className="canvas-area">
      <div
        ref={viewportRef}
        className="canvas-viewport"
        data-testid="canvas-viewport"
        onDragOver={(event) => {
          // Only the types are readable here; reading the data would always return an empty string.
          if (carriesAsset(event.dataTransfer)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(event) => void importDroppedAsset(event)}
      >
        <div
          className="canvas-frame"
          style={{ width: width * scale, height: height * scale, transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}
          data-tool={selectedTool}
          data-playing={isPlaying ? 'true' : 'false'}
          data-panning={isPanning ? 'true' : 'false'}
        >
          {displayedReferenceId !== null && (
            <canvas
              ref={onionCanvasRef}
              className="onion-reference-canvas"
              aria-hidden="true"
              data-testid="onion-reference-canvas"
              data-reference-frame-id={displayedReferenceId}
              width={width}
              height={height}
            />
          )}
          <canvas
            ref={canvasRef}
            className="drawing-canvas"
            aria-label={`Drawing canvas, ${width} by ${height} pixels`}
            data-testid="drawing-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHoverPoint(null)}
            onPointerUp={onPointerUp}
            onPointerCancel={(event) => session.pointerCancel(event.pointerId)}
            onLostPointerCapture={(event) => session.pointerCancel(event.pointerId)}
            onContextMenu={(event) => event.preventDefault()}
            onDoubleClick={onDoubleClick}
          />
          {overlayCurve !== null && (
            <CurveOverlay
              curve={overlayCurve}
              isDraft={draft !== null}
              selectedAnchor={selectedAnchor}
              width={width}
              height={height}
              scale={scale}
            />
          )}
          {placement !== null && (
            <div
              className="placement-overlay"
              data-testid="placement-overlay"
              style={{
                left: `${(placement.rect.x / width) * 100}%`,
                top: `${(placement.rect.y / height) * 100}%`,
                width: `${(placement.rect.width / width) * 100}%`,
                height: `${(placement.rect.height / height) * 100}%`
              }}
              onPointerDown={onPlacementPointerDown}
              onPointerMove={onPlacementPointerMove}
              onPointerUp={onPlacementPointerEnd}
              onPointerCancel={onPlacementPointerEnd}
            >
              <div className="placement-body" data-handle="move" aria-label="Move image" role="presentation" />
              {HANDLES.map((handle) => (
                <div
                  key={handle}
                  className={`placement-handle placement-handle-${handle}`}
                  data-handle={handle}
                  aria-label={`Resize image ${HANDLE_LABELS[handle]}`}
                  role="presentation"
                />
              ))}
            </div>
          )}
          {selectedTool === 'eraser' && !isPlaying && hoverPoint !== null && (
            <div
              className="eraser-preview"
              data-testid="eraser-preview"
              aria-hidden="true"
              style={{
                left: hoverPoint.x * scale,
                top: hoverPoint.y * scale,
                width: eraserSize * scale,
                height: eraserSize * scale
              }}
            />
          )}
        </div>
      </div>
      {placement !== null && (
        <div className="placement-bar" role="status">
          <span>Drag to move, drag the handles to resize (hold Shift to stretch). Edges snap to the canvas borders.</span>
          <button type="button" className="button button-primary placement-done" onClick={endPlacement}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
