import {
  DEFAULT_BRUSH_OPACITY,
  DEFAULT_BRUSH_SIZE
} from '../constants';
import type { BrushConfigState, BrushId, BrushSettings } from '../model';
import { parseToolSize } from '../validation';
import type { BrushDefinition } from './brush';
import { DEFAULT_BRUSH_ID, defaultBrushSettings, findBrush, sanitizeBrushSettings } from './registry';

/**
 * Size, opacity, brush type and per-type settings of a tool that paints with the brush
 * engine. Each such tool owns one, so their options never interfere.
 */
export class BrushConfig {
  private size = DEFAULT_BRUSH_SIZE;
  private opacity = DEFAULT_BRUSH_OPACITY;
  private type: BrushId = DEFAULT_BRUSH_ID;
  /** Every brush type keeps its own settings while the session lasts. */
  private readonly settings = defaultBrushSettings();

  get state(): BrushConfigState {
    return { size: this.size, opacity: this.opacity, type: this.type, settings: this.settings[this.type] };
  }

  /** The selected brush type with its current settings. */
  get current(): { readonly brush: BrushDefinition; readonly settings: BrushSettings } {
    return { brush: findBrush(this.type), settings: this.settings[this.type] };
  }

  /** Returns `false` for an invalid size. */
  setSize(value: string | number): boolean {
    const size = parseToolSize(value);
    if (size === null) {
      return false;
    }
    this.size = size;
    return true;
  }

  /** Rounds and clamps to 0-100. Returns `false` for a value that is not a number. */
  setOpacity(percent: number): boolean {
    if (!Number.isFinite(percent)) {
      return false;
    }
    this.opacity = Math.min(100, Math.max(0, Math.round(percent)));
    return true;
  }

  /** Unknown types fall back to the Basic Brush. Returns whether the selection changed. */
  setType(id: string): boolean {
    const brush = findBrush(id);
    if (brush.id === this.type) {
      return false;
    }
    this.type = brush.id;
    return true;
  }

  /** Changes one option of the selected type; invalid values are clamped or replaced by the default. */
  setSetting(key: string, value: number): void {
    const { brush, settings } = this.current;
    this.settings[brush.id] = sanitizeBrushSettings(brush, { ...settings, [key]: value });
  }
}
