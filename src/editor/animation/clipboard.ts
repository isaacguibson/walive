import type { FrameClipboard } from '../model';

type Listener = () => void;

/**
 * Editor-level frame clipboard (HU_00004 §29). It is deliberately independent of
 * the operating system clipboard because frames are structured drawing data.
 */
export class FrameClipboardStore {
  private value: FrameClipboard | null = null;
  private readonly listeners = new Set<Listener>();

  get(): FrameClipboard | null {
    return this.value;
  }

  set(value: FrameClipboard | null): void {
    this.value = value;
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** Shared by every editor session of the running application. */
export const applicationFrameClipboard = new FrameClipboardStore();
