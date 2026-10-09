import { MAX_ADD_FRAMES, DEFAULT_LAYER_NAME } from '../constants';
import { StrokeSession } from '../drawing/stroke';
import { EditorError } from '../errors';
import { HistoryManager, type Command } from '../history/history';
import { createIdGenerator } from '../ids';
import type { Frame, Layer } from '../model';
import { ANIMATION_LIMITS } from '@shared/types/animation';
import { applicationFrameClipboard, type FrameClipboardStore } from './clipboard';
import { cloneFrame, cloneLayer, createLayer, nextLayerName } from './frames';
import { createDrawing } from '../drawing/raster';

type Listener = () => void;

interface Structure {
  readonly frames: readonly Frame[];
  readonly activeFrameId: string;
  readonly activeLayerId: string;
}

/** Swaps the whole frame list/selection; the before/after values are plain references. */
class StructureCommand implements Command {
  constructor(
    readonly label: string,
    private readonly before: Structure,
    private readonly after: Structure,
    private readonly restore: (structure: Structure) => void
  ) {}

  execute(): void {
    this.restore(this.after);
  }

  undo(): void {
    this.restore(this.before);
  }
}

export interface AnimationEngineOptions {
  width: number;
  height: number;
  /** Initial content. When empty or omitted a single blank frame is created (HU_00004 §58). */
  frames?: readonly Frame[];
  history?: HistoryManager;
  clipboard?: FrameClipboardStore;
  idGenerator?: () => string;
}

/**
 * Single source of truth for the animation (HU_00004 §51, §67): frames, layers,
 * the active frame/layer and every operation that changes them. UI, tools and
 * playback go through this class; none of them keeps its own copy of the data.
 *
 * Every user-visible change is an undoable command executed through the
 * `HistoryManager`. Selecting a frame or layer is not undoable.
 */
export class AnimationEngine {
  readonly width: number;
  readonly height: number;
  readonly history: HistoryManager;
  readonly clipboard: FrameClipboardStore;

  private frames: readonly Frame[];
  private activeFrame: string;
  private activeLayer: string;
  private readonly newId: () => string;
  private readonly listeners = new Set<Listener>();
  private readonly contentListeners = new Set<Listener>();

  constructor(options: AnimationEngineOptions) {
    this.width = options.width;
    this.height = options.height;
    this.history = options.history ?? new HistoryManager();
    this.clipboard = options.clipboard ?? applicationFrameClipboard;
    this.newId = options.idGenerator ?? createIdGenerator();

    const initial =
      options.frames !== undefined && options.frames.length > 0
        ? options.frames.map((frame) => this.withAtLeastOneLayer(frame))
        : [this.createBlankFrame()];
    this.frames = initial;
    const first = initial[0] as Frame;
    this.activeFrame = first.id;
    this.activeLayer = (first.layers[0] as Layer).id;
  }

  // ---- Queries -----------------------------------------------------------

  getFrames(): readonly Frame[] {
    return this.frames;
  }

  getFrame(frameId: string): Frame | null {
    return this.frames.find((frame) => frame.id === frameId) ?? null;
  }

  getFrameIndex(frameId: string): number {
    return this.frames.findIndex((frame) => frame.id === frameId);
  }

  getActiveFrame(): Frame {
    return this.frames[this.getFrameIndex(this.activeFrame)] as Frame;
  }

  getActiveLayer(): Layer {
    const frame = this.getActiveFrame();
    return (frame.layers.find((layer) => layer.id === this.activeLayer) ?? frame.layers[0]) as Layer;
  }

  get activeFrameId(): string {
    return this.activeFrame;
  }

  get activeLayerId(): string {
    return this.activeLayer;
  }

  get isDirty(): boolean {
    return this.history.isDirty;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  // ---- Subscriptions -----------------------------------------------------

  /** Notified when frames, layers, selection or history state change. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Notified when pixels change (also while a stroke is in progress). */
  subscribeContent(listener: Listener): () => void {
    this.contentListeners.add(listener);
    return () => {
      this.contentListeners.delete(listener);
    };
  }

  // ---- Selection ---------------------------------------------------------

  selectFrame(frameId: string): void {
    const frame = this.requireFrame(frameId);
    if (frame.id === this.activeFrame) {
      return;
    }
    // Keep the same layer position when moving between frames so drawing flows naturally.
    const hint = this.activeLayerIndex();
    this.activeFrame = frame.id;
    this.activeLayer = this.layerAt(frame, hint).id;
    this.emit();
  }

  selectLayer(layerId: string): void {
    const frame = this.getActiveFrame();
    if (!frame.layers.some((layer) => layer.id === layerId)) {
      throw new EditorError('NOT_FOUND', 'The layer could not be found.');
    }
    if (layerId === this.activeLayer) {
      return;
    }
    this.activeLayer = layerId;
    this.emit();
  }

  // ---- Frame operations --------------------------------------------------

  /** Adds one blank frame after the active frame and selects it. */
  addFrame(): Frame {
    return this.addFrames(1)[0] as Frame;
  }

  /** Adds `count` blank frames immediately after the active frame; the last one is selected. */
  addFrames(count: number): Frame[] {
    if (!Number.isInteger(count) || count < 1) {
      throw new EditorError('INVALID_VALUE', 'Enter a whole number greater than 0.');
    }
    if (count > MAX_ADD_FRAMES) {
      throw new EditorError('LIMIT_EXCEEDED', `You can add at most ${MAX_ADD_FRAMES} frames at once.`);
    }
    this.assertFrameCapacity(count);

    const created = Array.from({ length: count }, () => this.createBlankFrame());
    const frames = this.insertAfterActive(created);
    const last = created[created.length - 1] as Frame;
    this.commit(count === 1 ? 'Add frame' : 'Add frames', {
      frames,
      activeFrameId: last.id,
      activeLayerId: (last.layers[0] as Layer).id
    });
    return created;
  }

  /** Inserts an independent copy right after `frameId` and selects it. */
  duplicateFrame(frameId: string): Frame {
    const source = this.requireFrame(frameId);
    this.assertFrameCapacity(1);
    const copy = cloneFrame(source, this.newId(), this.newId);
    const index = this.getFrameIndex(frameId);
    const frames = [...this.frames.slice(0, index + 1), copy, ...this.frames.slice(index + 1)];
    const hint = source.id === this.activeFrame ? this.activeLayerIndex() : 0;
    this.commit('Duplicate frame', {
      frames,
      activeFrameId: copy.id,
      activeLayerId: this.layerAt(copy, hint).id
    });
    return copy;
  }

  /** Removes a frame, selecting the next (else previous) one. An emptied animation gets a new blank frame. */
  removeFrame(frameId: string): void {
    this.commit('Remove frame', this.structureWithoutFrame(frameId));
  }

  /** Empties every layer of the frame while keeping the frame and its layer structure. */
  clearFrame(frameId: string): void {
    const frame = this.requireFrame(frameId);
    const cleared: Frame = {
      id: frame.id,
      layers: frame.layers.map((layer) => ({ ...layer, drawing: createDrawing(this.width, this.height) }))
    };
    this.commit('Clear frame', {
      frames: this.replaceFrame(frame.id, cleared),
      activeFrameId: this.activeFrame,
      activeLayerId: this.activeLayer
    });
  }

  /** Stores a deep copy of the frame in the editor clipboard. The animation is not modified. */
  copyFrame(frameId: string): void {
    const frame = this.requireFrame(frameId);
    this.clipboard.set({ operation: 'copy', frame: cloneFrame(frame, frame.id, this.newId) });
  }

  /** Copies the frame to the clipboard and removes it from the animation. */
  cutFrame(frameId: string): void {
    const frame = this.requireFrame(frameId);
    const structure = this.structureWithoutFrame(frameId);
    this.clipboard.set({ operation: 'cut', frame: cloneFrame(frame, frame.id, this.newId) });
    this.commit('Cut frame', structure);
  }

  /** Replaces the content of the frame with the clipboard content. No frame is created. */
  pasteFrame(frameId: string): void {
    const frame = this.requireFrame(frameId);
    const clip = this.clipboard.get();
    if (clip === null) {
      throw new EditorError('NOTHING_TO_PASTE', 'There is no copied frame to paste.');
    }
    const incoming = clip.frame.layers[0]?.drawing;
    if (incoming !== undefined && (incoming.width !== this.width || incoming.height !== this.height)) {
      throw new EditorError('CANVAS_MISMATCH', 'The copied frame has a different canvas size than this project.');
    }
    const hint = frame.id === this.activeFrame ? this.activeLayerIndex() : 0;
    const pasted = this.withAtLeastOneLayer({
      id: frame.id,
      layers: clip.frame.layers.map((layer) => cloneLayer(layer, this.newId()))
    });
    this.commit('Paste frame', {
      frames: this.replaceFrame(frame.id, pasted),
      activeFrameId: frame.id,
      activeLayerId: this.layerAt(pasted, hint).id
    });
  }

  // ---- Layer operations (always on the active frame) ---------------------

  /** Adds a blank layer above the active layer and selects it. */
  addLayer(): Layer {
    const frame = this.getActiveFrame();
    if (frame.layers.length >= ANIMATION_LIMITS.maxLayersPerFrame) {
      throw new EditorError('LIMIT_EXCEEDED', `A frame can have at most ${ANIMATION_LIMITS.maxLayersPerFrame} layers.`);
    }
    const layer = createLayer(this.newId(), nextLayerName(frame.layers, DEFAULT_LAYER_NAME), this.width, this.height);
    const index = this.activeLayerIndex();
    const layers = [...frame.layers.slice(0, index), layer, ...frame.layers.slice(index)];
    this.commit('Add layer', {
      frames: this.replaceFrame(frame.id, { id: frame.id, layers }),
      activeFrameId: frame.id,
      activeLayerId: layer.id
    });
    return layer;
  }

  renameLayer(layerId: string, name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > ANIMATION_LIMITS.maxLayerNameLength) {
      throw new EditorError(
        'INVALID_VALUE',
        `Layer names must have 1 to ${ANIMATION_LIMITS.maxLayerNameLength} characters.`
      );
    }
    const layer = this.requireActiveFrameLayer(layerId);
    if (layer.name === trimmed) {
      return;
    }
    this.updateLayer('Rename layer', layerId, (current) => ({ ...current, name: trimmed }));
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    const layer = this.requireActiveFrameLayer(layerId);
    if (layer.visible === visible) {
      return;
    }
    this.updateLayer(visible ? 'Show layer' : 'Hide layer', layerId, (current) => ({ ...current, visible }));
  }

  /** Removes a layer. A frame always keeps at least one layer. */
  removeLayer(layerId: string): void {
    const frame = this.getActiveFrame();
    this.requireActiveFrameLayer(layerId);
    if (frame.layers.length === 1) {
      throw new EditorError('LAST_LAYER', 'A frame must keep at least one layer.');
    }
    const index = frame.layers.findIndex((layer) => layer.id === layerId);
    const layers = frame.layers.filter((layer) => layer.id !== layerId);
    const activeLayerId =
      this.activeLayer === layerId ? (layers[Math.min(index, layers.length - 1)] as Layer).id : this.activeLayer;
    this.commit('Remove layer', {
      frames: this.replaceFrame(frame.id, { id: frame.id, layers }),
      activeFrameId: frame.id,
      activeLayerId
    });
  }

  /** Moves a layer to `toIndex` (0 = top-most). The stacking order of the canvas follows immediately. */
  reorderLayer(layerId: string, toIndex: number): void {
    const frame = this.getActiveFrame();
    this.requireActiveFrameLayer(layerId);
    const from = frame.layers.findIndex((layer) => layer.id === layerId);
    const to = Math.min(frame.layers.length - 1, Math.max(0, Math.trunc(toIndex)));
    if (from === to) {
      return;
    }
    const layers = [...frame.layers];
    const [moved] = layers.splice(from, 1);
    layers.splice(to, 0, moved as Layer);
    this.commit('Reorder layers', {
      frames: this.replaceFrame(frame.id, { id: frame.id, layers }),
      activeFrameId: frame.id,
      activeLayerId: this.activeLayer
    });
  }

  /** `up` moves the layer toward the top of the stack (rendered above), `down` toward the bottom. */
  moveLayer(layerId: string, direction: 'up' | 'down'): void {
    const frame = this.getActiveFrame();
    const index = frame.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) {
      throw new EditorError('NOT_FOUND', 'The layer could not be found.');
    }
    this.reorderLayer(layerId, direction === 'up' ? index - 1 : index + 1);
  }

  // ---- Drawing -----------------------------------------------------------

  /**
   * Starts a drawing gesture on the active layer of the active frame. The
   * result of the gesture is recorded in the history when it is committed.
   */
  beginStroke(label: string): StrokeSession {
    const frame = this.getActiveFrame();
    const layer = this.getActiveLayer();
    if (!layer.visible) {
      throw new EditorError('LAYER_HIDDEN', 'The active layer is hidden. Show the layer to draw on it.');
    }
    return new StrokeSession(label, { frameId: frame.id, layerId: layer.id }, layer.drawing, {
      record: (command) => {
        this.history.record(command);
        this.emit();
      },
      contentChanged: () => this.emitContent()
    });
  }

  // ---- History -----------------------------------------------------------

  undo(): boolean {
    const command = this.history.undo();
    return this.afterHistoryChange(command);
  }

  redo(): boolean {
    const command = this.history.redo();
    return this.afterHistoryChange(command);
  }

  /** Token identifying the current content; pass it to `markSaved` once it has been persisted. */
  getSaveToken(): number {
    return this.history.getToken();
  }

  markSaved(token: number): void {
    this.history.markSaved(token);
    this.emit();
  }

  // ---- Internals ---------------------------------------------------------

  private afterHistoryChange(command: Command | null): boolean {
    if (command === null) {
      return false;
    }
    const focus = command.focus;
    if (focus !== undefined) {
      const frame = this.getFrame(focus.frameId);
      if (frame !== null && frame.layers.some((layer) => layer.id === focus.layerId)) {
        this.activeFrame = frame.id;
        this.activeLayer = focus.layerId;
      }
    }
    this.emit();
    return true;
  }

  private commit(label: string, next: Structure): void {
    const before = this.capture();
    this.history.execute(new StructureCommand(label, before, next, (structure) => this.restore(structure)));
    this.emit();
  }

  private capture(): Structure {
    return { frames: this.frames, activeFrameId: this.activeFrame, activeLayerId: this.activeLayer };
  }

  private restore(structure: Structure): void {
    this.frames = structure.frames;
    this.activeFrame = structure.activeFrameId;
    this.activeLayer = structure.activeLayerId;
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private emitContent(): void {
    this.contentListeners.forEach((listener) => listener());
  }

  private createBlankFrame(): Frame {
    return {
      id: this.newId(),
      layers: [createLayer(this.newId(), `${DEFAULT_LAYER_NAME} 1`, this.width, this.height)]
    };
  }

  private withAtLeastOneLayer(frame: Frame): Frame {
    if (frame.layers.length > 0) {
      return frame;
    }
    return { id: frame.id, layers: [createLayer(this.newId(), `${DEFAULT_LAYER_NAME} 1`, this.width, this.height)] };
  }

  private requireFrame(frameId: string): Frame {
    const frame = this.getFrame(frameId);
    if (frame === null) {
      throw new EditorError('NOT_FOUND', 'The frame could not be found.');
    }
    return frame;
  }

  private requireActiveFrameLayer(layerId: string): Layer {
    const layer = this.getActiveFrame().layers.find((candidate) => candidate.id === layerId);
    if (layer === undefined) {
      throw new EditorError('NOT_FOUND', 'The layer could not be found.');
    }
    return layer;
  }

  private assertFrameCapacity(additional: number): void {
    if (this.frames.length + additional > ANIMATION_LIMITS.maxFrames) {
      throw new EditorError('LIMIT_EXCEEDED', `An animation can have at most ${ANIMATION_LIMITS.maxFrames} frames.`);
    }
  }

  private activeLayerIndex(): number {
    const layers = this.getActiveFrame().layers;
    return Math.max(
      0,
      layers.findIndex((layer) => layer.id === this.activeLayer)
    );
  }

  private layerAt(frame: Frame, index: number): Layer {
    return frame.layers[Math.min(Math.max(0, index), frame.layers.length - 1)] as Layer;
  }

  private insertAfterActive(created: readonly Frame[]): readonly Frame[] {
    const index = this.getFrameIndex(this.activeFrame);
    const at = index < 0 ? this.frames.length : index + 1;
    return [...this.frames.slice(0, at), ...created, ...this.frames.slice(at)];
  }

  private replaceFrame(frameId: string, replacement: Frame): readonly Frame[] {
    return this.frames.map((frame) => (frame.id === frameId ? replacement : frame));
  }

  private updateLayer(label: string, layerId: string, change: (layer: Layer) => Layer): void {
    const frame = this.getActiveFrame();
    const layers = frame.layers.map((layer) => (layer.id === layerId ? change(layer) : layer));
    this.commit(label, {
      frames: this.replaceFrame(frame.id, { id: frame.id, layers }),
      activeFrameId: frame.id,
      activeLayerId: this.activeLayer
    });
  }

  private structureWithoutFrame(frameId: string): Structure {
    const index = this.getFrameIndex(frameId);
    if (index < 0) {
      throw new EditorError('NOT_FOUND', 'The frame could not be found.');
    }
    const remaining = this.frames.filter((frame) => frame.id !== frameId);
    if (remaining.length === 0) {
      const blank = this.createBlankFrame();
      return { frames: [blank], activeFrameId: blank.id, activeLayerId: (blank.layers[0] as Layer).id };
    }
    // Prefer the frame that followed the removed one, otherwise the previous one.
    const next = (remaining[index] ?? remaining[index - 1]) as Frame;
    if (frameId !== this.activeFrame) {
      return { frames: remaining, activeFrameId: this.activeFrame, activeLayerId: this.activeLayer };
    }
    return { frames: remaining, activeFrameId: next.id, activeLayerId: this.layerAt(next, this.activeLayerIndex()).id };
  }
}
