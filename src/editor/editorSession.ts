import { AnimationEngine } from './animation/animationEngine';
import { applicationFrameClipboard, type FrameClipboardStore } from './animation/clipboard';
import { toAnimationDocument } from './animation/serialization';
import { BrushConfig } from './brushes/brushConfig';
import {
  DEFAULT_COLOR,
  DEFAULT_ERASER_SIZE,
  DEFAULT_FPS,
  DEFAULT_ZOOM,
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
  STABILIZE_SCREEN_RADIUS
} from './constants';
import type { AnchorType, CurveStyle } from './curves/curve';
import { EditorError } from './errors';
import type {
  CurveEditorState,
  EditorState,
  Frame,
  Layer,
  SelectionOptions,
  SelectionPreview,
  SelectionResampling,
  SelectionState,
  ToolType
} from './model';
import { PlaybackController, browserClock, type PlaybackClock } from './playback/playbackController';
import type { ShortcutAction } from './shortcuts/shortcuts';
import { createTools, type Tools } from './tools';
import type { ToolContext, ToolPointerEvent } from './tools/tool';
import { parseFps, parseHexColor, parseToolSize, parseZoom } from './validation';
import type { AnimationDocument } from '@shared/types/animation';

export interface EditorSessionOptions {
  /** Logical canvas size from the project metadata. */
  width: number;
  height: number;
  /** Stored frames; omitted or empty creates `Frame 1 / Layer 1`. */
  frames?: readonly Frame[];
  manualReferenceFrameId?: string | null;
  clipboard?: FrameClipboardStore;
  clock?: PlaybackClock;
  idGenerator?: () => string;
  /** Source of the seeds of randomized brushes; random by default. Tests inject a fixed one. */
  strokeSeed?: () => number;
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
  readonly onionEnabled: boolean;
  readonly manualReferenceFrameId: string | null;
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

  private readonly tools: Tools;
  private readonly listeners = new Set<() => void>();
  private clipboardUnsubscribe: (() => void) | null = null;
  private cachedClipboard: unknown = undefined;
  private version = 0;
  private cached: EditorSnapshot | null = null;

  private selectedTool: ToolType = 'brush';
  private color = DEFAULT_COLOR;
  private readonly brush = new BrushConfig();
  private readonly curveBrush = new BrushConfig();
  private curveEditor: CurveEditorState = { draft: null, selectedCurveId: null, selectedAnchor: null };
  private selection: SelectionState | null = null;
  private selectionOptions: SelectionOptions = { keepAspectRatio: false, resampling: 'smooth' };
  private readonly strokeSeed: () => number;
  private usePenPressure = false;
  private usePenPressureOpacity = false;
  private stabilizeStroke = false;
  private onionEnabled = false;
  private eraserSize = DEFAULT_ERASER_SIZE;
  private zoom = DEFAULT_ZOOM;
  private fps = DEFAULT_FPS;
  private loop = true;
  private error: string | null = null;
  private activePointerId: number | null = null;

  constructor(options: EditorSessionOptions) {
    if (!isSupportedCanvasSize(options.width, options.height)) {
      throw new EditorError('CANVAS_UNSUPPORTED', "This project's canvas size is not supported by the editor.");
    }
    this.clipboard = options.clipboard ?? applicationFrameClipboard;
    this.strokeSeed = options.strokeSeed ?? (() => Math.floor(Math.random() * 0x1_0000_0000));
    this.engine = new AnimationEngine({
      width: options.width,
      height: options.height,
      ...(options.frames !== undefined ? { frames: options.frames } : {}),
      ...(options.manualReferenceFrameId !== undefined ? { manualReferenceFrameId: options.manualReferenceFrameId } : {}),
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
    const brush = this.brush.state;
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
        brushSize: brush.size,
        brushOpacity: brush.opacity,
        brushType: brush.type,
        brushSettings: brush.settings,
        usePenPressure: this.usePenPressure,
        usePenPressureOpacity: this.usePenPressureOpacity,
        stabilizeStroke: this.stabilizeStroke,
        eraserSize: this.eraserSize,
        curveBrush: this.curveBrush.state,
        curveEditor: this.curveEditor,
        selection: this.selection,
        selectionOptions: this.selectionOptions
      },
      frames: this.engine.getFrames(),
      activeFrame,
      activeLayer: this.engine.getActiveLayer(),
      canUndo: this.engine.canUndo || this.tools.select.hasPending(),
      canRedo: this.engine.canRedo,
      canPaste: clipboardValue !== null,
      // A transformation that is still waiting to be applied is a change that has not been saved.
      isDirty: this.engine.isDirty || this.tools.select.hasPending(),
      onionEnabled: this.onionEnabled,
      manualReferenceFrameId: this.engine.manualReferenceFrameId,
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
    return this.changeBrush(this.brush.setSize(value));
  }

  /** Selects a brush type; unknown types fall back to the Basic Brush. Existing strokes are not affected. */
  setBrushType(id: string): void {
    this.changeBrush(this.brush.setType(id));
  }

  /** Changes one option of the selected brush type; invalid values are clamped or replaced by the default. */
  setBrushSetting(key: string, value: number): void {
    this.brush.setSetting(key, value);
    this.bump();
  }

  /** Sets the base opacity of brush strokes, in percent; values are rounded and clamped to 0-100. */
  setBrushOpacity(percent: number): void {
    this.changeBrush(this.brush.setOpacity(percent));
  }

  /** Options of new curves. They have no effect on curves that already exist (see `applyCurveStyle`). */
  setCurveSize(value: string | number): boolean {
    return this.changeBrush(this.curveBrush.setSize(value));
  }

  setCurveBrushType(id: string): void {
    this.changeBrush(this.curveBrush.setType(id));
  }

  setCurveBrushSetting(key: string, value: number): void {
    this.curveBrush.setSetting(key, value);
    this.bump();
  }

  setCurveOpacity(percent: number): void {
    this.changeBrush(this.curveBrush.setOpacity(percent));
  }

  setUsePenPressure(enabled: boolean): void {
    if (this.usePenPressure === enabled) {
      return;
    }
    this.usePenPressure = enabled;
    this.bump();
  }

  setUsePenPressureOpacity(enabled: boolean): void {
    if (this.usePenPressureOpacity === enabled) {
      return;
    }
    this.usePenPressureOpacity = enabled;
    this.bump();
  }

  setStabilizeStroke(enabled: boolean): void {
    if (this.stabilizeStroke === enabled) {
      return;
    }
    this.stabilizeStroke = enabled;
    this.bump();
  }

  setOnionEnabled(enabled: boolean): void {
    if (this.onionEnabled === enabled) {
      return;
    }
    this.onionEnabled = enabled;
    this.bump();
  }

  setManualReferenceFrame(frameId: string | null): void {
    this.edit(() => this.engine.setManualReferenceFrame(frameId));
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

  setSelectionKeepAspectRatio(keepAspectRatio: boolean): void {
    this.selectionOptions = { ...this.selectionOptions, keepAspectRatio };
    this.bump();
  }

  /** Changes how the selection is sampled; a transformation that is waiting to be applied shows it at once. */
  setSelectionResampling(resampling: SelectionResampling): void {
    this.selectionOptions = { ...this.selectionOptions, resampling };
    this.bump();
  }

  /** Transformed pixels to show over the active layer; `null` unless the Selection Tool has a pending change. */
  getSelectionPreview(): SelectionPreview | null {
    return this.tools.select.preview();
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

  /** Second click of a double-click, already converted to canvas pixels. */
  doubleClick(event: ToolPointerEvent): void {
    if (this.playback.isPlaying || this.activePointerId !== null) {
      return;
    }
    this.guardTool(() => this.tools[this.selectedTool].doubleClick?.(event));
  }

  // ---- Bézier curves (act on the curve being drawn or the selected one) ---

  /** Completes the curve being drawn. */
  finishCurve(): void {
    this.curveAction((tool) => tool.finish());
  }

  /** Discards the curve being drawn; without one, clears the curve selection. */
  cancelCurve(): void {
    this.curveAction((tool) => tool.cancel());
  }

  /** Removes the selected anchor or, when the path needs it, the whole selected curve. */
  deleteCurveSelection(): void {
    this.curveAction((tool) => tool.deleteSelection());
  }

  removeSelectedAnchor(): void {
    this.curveAction((tool) => tool.removeSelectedAnchor());
  }

  deleteSelectedCurve(): void {
    this.curveAction((tool) => tool.deleteSelectedCurve());
  }

  setSelectedAnchorType(type: AnchorType): void {
    this.curveAction((tool) => tool.setAnchorType(type));
  }

  /** Gives the selected curve the current options of the Bézier tool. */
  applyCurveStyle(): void {
    this.curveAction((tool) => tool.applyStyle());
  }

  // ---- Selection Tool ----------------------------------------------------

  /** Reverts a transformation waiting to be applied (nothing is recorded in the history); without one, clears the selection. */
  cancelSelection(): void {
    if (this.playback.isPlaying || this.activePointerId !== null || this.selectedTool !== 'select') {
      return;
    }
    this.tools.select.cancel();
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
    this.settlePending();
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

  /** Selects the following frame, creating one empty frame at the end. */
  nextFrame(): void {
    if (this.activePointerId !== null) {
      return;
    }
    this.playback.stop();
    const index = this.engine.getFrameIndex(this.engine.activeFrameId);
    if (index >= 0 && index < this.engine.getFrames().length - 1) {
      this.selectFrame(this.engine.getFrames()[index + 1]!.id);
    } else if (index === this.engine.getFrames().length - 1) {
      this.addFrame();
    }
  }

  /** Selects the preceding frame, doing nothing at the beginning of the timeline. */
  previousFrame(): void {
    if (this.activePointerId !== null) {
      return;
    }
    this.playback.stop();
    const index = this.engine.getFrameIndex(this.engine.activeFrameId);
    if (index > 0) {
      this.selectFrame(this.engine.getFrames()[index - 1]!.id);
    }
  }

  // ---- Selection ---------------------------------------------------------

  selectFrame(frameId: string): void {
    if (this.activePointerId !== null) {
      return;
    }
    this.playback.stop();
    this.settlePending();
    this.run(() => this.engine.selectFrame(frameId));
  }

  selectLayer(layerId: string): void {
    if (this.activePointerId !== null) {
      return;
    }
    this.playback.stop();
    this.settlePending();
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

  reorderFrame(frameId: string, toIndex: number): void {
    this.edit(() => this.engine.reorderFrame(frameId, toIndex));
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
    // An unfinished curve or transformation is the latest action: undoing discards it instead of stepping back in the history.
    if (this.curveEditor.draft !== null) {
      this.cancelCurve();
      return;
    }
    if (this.tools.select.hasPending()) {
      this.cancelSelection();
      return;
    }
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
      case 'frame.next':
        this.nextFrame();
        return true;
      case 'frame.previous':
        this.previousFrame();
        return true;
      case 'playback.toggle':
        this.togglePlayback();
        return true;
      case 'history.undo':
        this.undo();
        return true;
      case 'history.redo':
        this.redo();
        return true;
      case 'tool.finish':
      case 'tool.cancel':
      case 'tool.delete':
        if (this.selectedTool === 'select') {
          // The selection only answers to Escape.
          if (action === 'tool.cancel') {
            this.cancelSelection();
          }
          return action === 'tool.cancel';
        }
        if (this.selectedTool !== 'bezier') {
          return false;
        }
        if (action === 'tool.finish') {
          this.finishCurve();
        } else if (action === 'tool.cancel') {
          this.cancelCurve();
        } else {
          this.deleteCurveSelection();
        }
        return true;
      default:
        return false;
    }
  }

  // ---- Persistence hand-off (no I/O here) ---------------------------------

  /** Builds the document to persist, plus a token to pass to `markSaved` once it was stored. */
  createSaveRequest(): { document: AnimationDocument; token: number } {
    this.settlePending();
    return {
      document: toAnimationDocument(
        this.engine.width,
        this.engine.height,
        this.engine.getFrames(),
        this.engine.manualReferenceFrameId
      ),
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
    this.settlePending();
    return this.run(operation);
  }

  /**
   * Finishes what the tools still have open, so that changing frame, layer or content never leaves
   * a loose path or an unapplied transformation behind: the curve is completed and the selection is applied.
   */
  private settlePending(): void {
    if (this.curveEditor.draft !== null) {
      this.run(() => this.tools.bezier.finish());
    }
    this.tools.select.settle();
  }

  private curveAction(action: (tool: Tools['bezier']) => void): void {
    if (this.playback.isPlaying || this.activePointerId !== null || this.selectedTool !== 'bezier') {
      return;
    }
    this.guardTool(() => action(this.tools.bezier));
  }

  private changeBrush(applied: boolean): boolean {
    if (applied) {
      this.bump();
    }
    return applied;
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

  /** The active layer when it accepts new content; reports why when it does not. */
  private editableLayer(): Layer | null {
    const layer = this.engine.getActiveLayer();
    if (!layer.visible) {
      this.reportError('The active layer is hidden. Show the layer to draw on it.');
      return null;
    }
    return layer;
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
      getBrushSize: () => this.brush.state.size,
      getBrushOpacity: () => this.brush.state.opacity / 100,
      getBrush: () => this.brush.current,
      nextStrokeSeed: this.strokeSeed,
      getUsePenPressure: () => this.usePenPressure,
      getUsePenPressureOpacity: () => this.usePenPressureOpacity,
      getStabilizeStroke: () => this.stabilizeStroke,
      // The rope keeps a constant on-screen length, whatever the zoom.
      getStabilizeRadius: () => STABILIZE_SCREEN_RADIUS / (this.zoom / 100),
      getEraserSize: () => this.eraserSize,
      beginCurveEdit: (label) => {
        try {
          return this.engine.beginCurveEdit(label);
        } catch (error) {
          if (error instanceof EditorError) {
            this.reportError(error.message);
            return null;
          }
          throw error;
        }
      },
      canEditCurves: () => this.editableLayer() !== null,
      getCurves: () => this.engine.getActiveLayer().curves,
      newCurveStyle: (): CurveStyle => {
        const { brush, settings } = this.curveBrush.current;
        const { size, opacity } = this.curveBrush.state;
        return { brush: brush.id, settings, color: this.color, size, opacity, seed: this.strokeSeed() };
      },
      createId: () => this.engine.createId(),
      toCanvasDistance: (screenPixels) => screenPixels / (this.zoom / 100),
      setCurveEditor: (state) => {
        this.curveEditor = state;
        this.bump();
      },
      getActiveLayerPixels: () => {
        const layer = this.editableLayer();
        return layer === null ? null : { layerId: layer.id, drawing: layer.drawing };
      },
      getSelectionOptions: () => this.selectionOptions,
      setSelection: (state) => {
        if (state === null && this.selection === null) {
          return;
        }
        this.selection = state;
        this.bump();
      },
      reportError: (message) => this.reportError(message)
    };
  }
}
