import { AnimationEngine } from './animation/animationEngine';
import { applicationFrameClipboard, type FrameClipboardStore } from './animation/clipboard';
import { toAnimationDocument } from './animation/serialization';
import {
  DEFAULT_BRUSH_SIZE,
  DEFAULT_COLOR,
  DEFAULT_ERASER_SIZE,
  DEFAULT_FPS,
  DEFAULT_ZOOM,
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS
} from './constants';
import { compositePixel } from './drawing/raster';
import { EditorError } from './errors';
import type { EditorState, Frame, Layer, Rect, ToolType } from './model';
import { PlaybackController, browserClock, type PlaybackClock } from './playback/playbackController';
import type { ShortcutAction } from './shortcuts/shortcuts';
import { createTools } from './tools';
import type { EditorTool, ToolContext, ToolPointerEvent } from './tools/tool';
import { parseFps, parseHexColor, parseToolSize, parseZoom, toHexColor } from './validation';
import type { AnimationDocument } from '@shared/types/animation';

export interface EditorSessionOptions {
  /** Logical canvas size from the project metadata. */
  width: number;
  height: number;
  /** Stored frames; omitted or empty creates `Frame 1 / Layer 1`. */
  frames?: readonly Frame[];
  clipboard?: FrameClipboardStore;
  clock?: PlaybackClock;
  idGenerator?: () => string;
}

/** Immutable view of the editor for the UI. A new object is produced whenever anything it shows changes. */
export interface EditorSnapshot {
  readonly version: number;
  readonly width: number;
  readonly height: number;
  readonly state: EditorState;
  readonly frames: readonly Frame[];
  readonly activeFrame: Frame;
  readonly activeLayer: Layer;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canPaste: boolean;
  readonly isDirty: boolean;
  /** Last operation error to show to the user, if any. */
  readonly error: string | null;
}

export function isSupportedCanvasSize(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_CANVAS_DIMENSION &&
    height <= MAX_CANVAS_DIMENSION &&
    width * height <= MAX_CANVAS_PIXELS
  );
}

/**
 * Editor-level state and actions (HU_00043 §43). It composes the animation
 * engine (frames/layers/history), the tools and the playback controller, and is
 * the only object the UI talks to. It performs no I/O.
 */
export class EditorSession {
  readonly engine: AnimationEngine;
  readonly playback: PlaybackController;
  readonly clipboard: FrameClipboardStore;

  private readonly tools: Record<ToolType, EditorTool>;
  private readonly listeners = new Set<() => void>();
  private clipboardUnsubscribe: (() => void) | null = null;
  private cachedClipboard: unknown = undefined;
  private version = 0;
  private cached: EditorSnapshot | null = null;

  private selectedTool: ToolType = 'brush';
  private color = DEFAULT_COLOR;
  private brushSize = DEFAULT_BRUSH_SIZE;
  private eraserSize = DEFAULT_ERASER_SIZE;
  private zoom = DEFAULT_ZOOM;
  private fps = DEFAULT_FPS;
  private loop = true;
  private selection: Rect | null = null;
  private error: string | null = null;
  private activePointerId: number | null = null;

  constructor(options: EditorSessionOptions) {
    if (!isSupportedCanvasSize(options.width, options.height)) {
      throw new EditorError('CANVAS_UNSUPPORTED', "This project's canvas size is not supported by the editor.");
    }
    this.clipboard = options.clipboard ?? applicationFrameClipboard;
    this.engine = new AnimationEngine({
      width: options.width,
      height: options.height,
      ...(options.frames !== undefined ? { frames: options.frames } : {}),
      ...(options.idGenerator !== undefined ? { idGenerator: options.idGenerator } : {}),
      clipboard: this.clipboard
    });

    this.playback = new PlaybackController(
      {
        getFrameIds: () => this.engine.getFrames().map((frame) => frame.id),
        getActiveFrameId: () => this.engine.activeFrameId,
        selectFrame: (frameId) => this.engine.selectFrame(frameId),
        getFps: () => this.fps,
        isLoop: () => this.loop
      },
      () => this.bump(),
      options.clock ?? browserClock
    );

    this.tools = createTools(this.createToolContext(options.width, options.height));
    // The engine belongs to this session, so listening to it for the whole lifetime is not a leak.
    this.engine.subscribe(() => this.bump());
  }

  // ---- Subscription (compatible with React's useSyncExternalStore) -------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    // The clipboard is application-wide: only listen to it while somebody is watching this session.
    if (this.clipboardUnsubscribe === null) {
      this.clipboardUnsubscribe = this.clipboard.subscribe(() => this.bump());
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.clipboardUnsubscribe !== null) {
        this.clipboardUnsubscribe();
        this.clipboardUnsubscribe = null;
      }
    };
  };

  readonly getSnapshot = (): EditorSnapshot => {
    const clipboardValue = this.clipboard.get();
    if (this.cached !== null && this.cached.version === this.version && this.cachedClipboard === clipboardValue) {
      return this.cached;
    }
    this.cachedClipboard = clipboardValue;
    const activeFrame = this.engine.getActiveFrame();
    this.cached = {
      version: this.version,
      width: this.engine.width,
      height: this.engine.height,
      state: {
        activeFrameId: this.engine.activeFrameId,
        activeLayerId: this.engine.activeLayerId,
        selectedTool: this.selectedTool,
        zoom: this.zoom,
        fps: this.fps,
        loopPlayback: this.loop,
        isPlaying: this.playback.isPlaying,
        color: this.color,
        brushSize: this.brushSize,
        eraserSize: this.eraserSize,
        selection: this.selection
      },
      frames: this.engine.getFrames(),
      activeFrame,
      activeLayer: this.engine.getActiveLayer(),
      canUndo: this.engine.canUndo,
      canRedo: this.engine.canRedo,
      canPaste: clipboardValue !== null,
      isDirty: this.engine.isDirty,
      error: this.error
    };
    return this.cached;
  };

  // ---- Tools and tool settings -------------------------------------------

  selectTool(tool: ToolType): void {
    if (tool === this.selectedTool || this.activePointerId !== null) {
      return;
    }
    this.tools[this.selectedTool].deactivate();
    this.selectedTool = tool;
    this.tools[tool].activate();
    this.bump();
  }

  /** Sets the shared drawing color (`#rrggbb`). Returns `false` for an invalid value. */
  setColor(value: string): boolean {
    if (parseHexColor(value) === null) {
      return false;
    }
    this.color = value.toLowerCase();
    this.bump();
    return true;
  }

  setBrushSize(value: string | number): boolean {
    const size = parseToolSize(value);
    if (size === null) {
      return false;
    }
    this.brushSize = size;
    this.bump();
    return true;
  }

  setEraserSize(value: string | number): boolean {
    const size = parseToolSize(value);
    if (size === null) {
      return false;
    }
    this.eraserSize = size;
    this.bump();
    return true;
  }

  // ---- Pointer input (already converted to canvas pixels) -----------------

  pointerDown(event: ToolPointerEvent): void {
    if (this.playback.isPlaying || this.activePointerId !== null) {
      return;
    }
    this.activePointerId = event.pointerId;
    this.guardTool(() => this.tools[this.selectedTool].pointerDown(event));
  }

  pointerMove(event: ToolPointerEvent): void {
    if (this.activePointerId !== event.pointerId) {
      return;
    }
    if (event.buttons === 0) {
      // The button was released outside of the window/canvas: end the gesture instead of drawing on.
      this.pointerUp(event);
      return;
    }
    this.guardTool(() => this.tools[this.selectedTool].pointerMove(event));
  }

  pointerUp(event: ToolPointerEvent): void {
    if (this.activePointerId !== event.pointerId) {
      return;
    }
    this.guardTool(() => this.tools[this.selectedTool].pointerUp(event));
    this.activePointerId = null;
  }

  pointerCancel(pointerId: number): void {
    if (this.activePointerId !== pointerId) {
      return;
    }
    this.guardTool(() => this.tools[this.selectedTool].pointerCancel());
    this.activePointerId = null;
  }

  get isDrawing(): boolean {
    return this.activePointerId !== null;
  }

  // ---- View, FPS, playback -----------------------------------------------

  /** Sets the zoom percentage. Values that are not greater than zero are rejected. */
  setZoom(value: string | number): boolean {
    const zoom = parseZoom(value);
    if (zoom === null) {
      return false;
    }
    if (zoom !== this.zoom) {
      this.zoom = zoom;
      this.bump();
    }
    return true;
  }

  /** Sets the playback speed. Only positive integers are accepted. */
  setFps(value: string | number): boolean {
    const fps = parseFps(value);
    if (fps === null) {
      return false;
    }
    if (fps !== this.fps) {
      this.fps = fps;
      this.bump();
    }
    return true;
  }

  setLoop(loop: boolean): void {
    if (loop !== this.loop) {
      this.loop = loop;
      this.bump();
    }
  }

  play(): boolean {
    if (this.activePointerId !== null) {
      return false;
    }
    return this.playback.start();
  }

  stop(): void {
    this.playback.stop();
  }

  togglePlayback(): void {
    if (this.playback.isPlaying) {
      this.stop();
    } else {
      this.play();
    }
  }

  // ---- Selection ---------------------------------------------------------

  selectFrame(frameId: string): void {
    if (this.activePointerId !== null) {
      return;
    }
    this.playback.stop();
    this.run(() => this.engine.selectFrame(frameId));
  }

  selectLayer(layerId: string): void {
    if (this.activePointerId !== null) {
      return;
    }
    this.playback.stop();
    this.run(() => this.engine.selectLayer(layerId));
  }

  // ---- Frame operations (default target: the active frame) ----------------

  addFrame(): void {
    this.edit(() => this.engine.addFrame());
  }

  addFrames(count: number): boolean {
    return this.edit(() => this.engine.addFrames(count)) !== undefined;
  }

  duplicateFrame(frameId: string = this.engine.activeFrameId): void {
    this.edit(() => this.engine.duplicateFrame(frameId));
  }

  removeFrame(frameId: string = this.engine.activeFrameId): void {
    this.edit(() => this.engine.removeFrame(frameId));
  }

  clearFrame(frameId: string = this.engine.activeFrameId): void {
    this.edit(() => this.engine.clearFrame(frameId));
  }

  copyFrame(frameId: string = this.engine.activeFrameId): void {
    this.edit(() => this.engine.copyFrame(frameId));
  }

  cutFrame(frameId: string = this.engine.activeFrameId): void {
    this.edit(() => this.engine.cutFrame(frameId));
  }

  pasteFrame(frameId: string = this.engine.activeFrameId): void {
    if (this.clipboard.get() === null) {
      return;
    }
    this.edit(() => this.engine.pasteFrame(frameId));
  }

  // ---- Layer operations (active frame) -----------------------------------

  addLayer(): void {
    this.edit(() => this.engine.addLayer());
  }

  /** Adds a layer above the active one with the given pixels. Returns the new layer id, or `null` when it was not added. */
  addLayerFromPixels(name: string, pixels: Uint8ClampedArray): string | null {
    const layer = this.edit(() => {
      const drawing = { width: this.engine.width, height: this.engine.height, data: pixels, revision: 0, dirty: null };
      return this.engine.addLayerFromDrawing(name, drawing);
    });
    return layer?.id ?? null;
  }

  /**
   * Replaces the pixels of a layer without creating a history entry. Used while
   * an image that was just added is being moved or resized. Returns `false`
   * when the layer is gone (undo, another frame) or editing is not allowed.
   */
  updateLayerPixels(layerId: string, pixels: Uint8ClampedArray): boolean {
    return (
      this.edit(() => {
        this.engine.setLayerPixels(layerId, pixels);
        return true;
      }) === true
    );
  }

  /** Whether the active frame still has a layer with this id. */
  hasActiveFrameLayer(layerId: string): boolean {
    return this.engine.getActiveFrame().layers.some((layer) => layer.id === layerId);
  }

  renameLayer(layerId: string, name: string): boolean {
    return (
      this.edit(() => {
        this.engine.renameLayer(layerId, name);
        return true;
      }) === true
    );
  }

  removeLayer(layerId: string): void {
    this.edit(() => this.engine.removeLayer(layerId));
  }

  moveLayer(layerId: string, direction: 'up' | 'down'): void {
    this.edit(() => this.engine.moveLayer(layerId, direction));
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    this.edit(() => this.engine.setLayerVisible(layerId, visible));
  }

  // ---- History -----------------------------------------------------------

  undo(): void {
    this.edit(() => this.engine.undo());
  }

  redo(): void {
    this.edit(() => this.engine.redo());
  }

  /** Executes an action bound to a keyboard shortcut. Returns `false` for actions the session does not own. */
  runShortcut(action: ShortcutAction): boolean {
    switch (action) {
      case 'frame.copy':
        this.copyFrame();
        return true;
      case 'frame.paste':
        this.pasteFrame();
        return true;
      case 'frame.cut':
        this.cutFrame();
        return true;
      case 'frame.duplicate':
        this.duplicateFrame();
        return true;
      case 'history.undo':
        this.undo();
        return true;
      case 'history.redo':
        this.redo();
        return true;
      default:
        return false;
    }
  }

  // ---- Persistence hand-off (no I/O here) ---------------------------------

  /** Builds the document to persist, plus a token to pass to `markSaved` once it was stored. */
  createSaveRequest(): { document: AnimationDocument; token: number } {
    return {
      document: toAnimationDocument(this.engine.width, this.engine.height, this.engine.getFrames()),
      token: this.engine.getSaveToken()
    };
  }

  markSaved(token: number): void {
    this.engine.markSaved(token);
  }

  // ---- Errors ------------------------------------------------------------

  reportError(message: string): void {
    this.error = message;
    this.bump();
  }

  clearError(): void {
    if (this.error !== null) {
      this.error = null;
      this.bump();
    }
  }

  /** Stops playback and timers. The session stays usable (React StrictMode re-mounts components). */
  dispose(): void {
    this.playback.dispose();
  }

  // ---- Internals ---------------------------------------------------------

  private bump(): void {
    this.version += 1;
    this.cached = null;
    this.listeners.forEach((listener) => listener());
  }

  /** Runs an editing operation unless playback or a drawing gesture is in progress. */
  private edit<T>(operation: () => T): T | undefined {
    if (this.playback.isPlaying || this.activePointerId !== null) {
      return undefined;
    }
    return this.run(operation);
  }

  private run<T>(operation: () => T): T | undefined {
    try {
      const result = operation();
      if (this.error !== null) {
        this.error = null;
        this.bump();
      }
      return result;
    } catch (error) {
      if (error instanceof EditorError) {
        this.reportError(error.message);
        return undefined;
      }
      throw error;
    }
  }

  private guardTool(operation: () => void): void {
    try {
      operation();
    } catch (error) {
      this.activePointerId = null;
      this.reportError(error instanceof EditorError ? error.message : 'The drawing action could not be completed.');
    }
  }

  private createToolContext(width: number, height: number): ToolContext {
    return {
      width,
      height,
      beginStroke: (label) => {
        try {
          return this.engine.beginStroke(label);
        } catch (error) {
          if (error instanceof EditorError) {
            this.reportError(error.message);
            return null;
          }
          throw error;
        }
      },
      getColor: () => parseHexColor(this.color) ?? [0, 0, 0],
      setColor: (color) => {
        this.setColor(toHexColor(color));
      },
      getBrushSize: () => this.brushSize,
      getEraserSize: () => this.eraserSize,
      pickColor: (x, y) => {
        const pixel = compositePixel(this.engine.getActiveFrame().layers, x, y);
        return pixel === null ? null : [pixel[0], pixel[1], pixel[2]];
      },
      setSelection: (selection) => {
        this.selection = selection;
        this.bump();
      }
    };
  }
}
