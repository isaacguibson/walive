import type { BrushId, BrushSettings } from '../model';
import type { BrushDefinition, BrushOption } from './brush';
import { basicBrush } from './basicBrush';
import { particleBrush } from './particleBrush';
import { chalkBrush, charcoalBrush, pencilBrush } from './textureBrushes';

/** Brushes in display order. A new brush type only needs a definition and an entry here (plus its id in `BrushId`). */
export const BRUSHES: readonly BrushDefinition[] = [basicBrush, pencilBrush, charcoalBrush, chalkBrush, particleBrush];

export const DEFAULT_BRUSH_ID: BrushId = 'basic';

/** The brush with the given id; unknown ids (for example from a newer version) fall back to the Basic Brush. */
export function findBrush(id: string): BrushDefinition {
  return BRUSHES.find((brush) => brush.id === id) ?? basicBrush;
}

export function defaultBrushSettings(): Record<BrushId, BrushSettings> {
  return Object.fromEntries(BRUSHES.map((brush) => [brush.id, brush.defaultSettings])) as Record<BrushId, BrushSettings>;
}

function clampBrushOption(option: BrushOption, value: number): number {
  return Math.min(option.max, Math.max(option.min, Math.round(value)));
}

/** Valid settings for `brush`: missing, non-numeric and out-of-range values are replaced by defaults or clamped. */
export function sanitizeBrushSettings(brush: BrushDefinition, raw: unknown): BrushSettings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    brush.options.map((option) => {
      const value = source[option.key];
      const fallback = brush.defaultSettings[option.key] as number;
      return [option.key, typeof value === 'number' && Number.isFinite(value) ? clampBrushOption(option, value) : fallback];
    })
  );
}
