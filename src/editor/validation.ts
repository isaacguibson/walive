import { MAX_FPS, MAX_TOOL_SIZE, MAX_ZOOM, MIN_ZOOM } from './constants';
import type { Rgb } from './model';

/** Parses a strictly positive integer. Rejects `0`, negatives, decimals, empty and non-numeric input. */
export function parseWholeNumber(value: string | number): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const text = value.trim();
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseFps(value: string | number): number | null {
  const parsed = parseWholeNumber(value);
  return parsed !== null && parsed <= MAX_FPS ? parsed : null;
}

export function parseToolSize(value: string | number): number | null {
  const parsed = parseWholeNumber(value);
  return parsed !== null && parsed <= MAX_TOOL_SIZE ? parsed : null;
}

export function clampZoom(zoom: number): number {
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 100) / 100;
}

/** Parses a zoom percentage. Values must be greater than zero; they are clamped to the supported range. */
export function parseZoom(value: string | number): number | null {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else {
    const text = value.trim();
    if (!/^\d+(\.\d+)?$/.test(text)) {
      return null;
    }
    parsed = Number(text);
  }
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return clampZoom(parsed);
}

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

export function parseHexColor(value: string): Rgb | null {
  const match = HEX_COLOR.exec(value);
  if (!match) {
    return null;
  }
  return [parseInt(match[1] as string, 16), parseInt(match[2] as string, 16), parseInt(match[3] as string, 16)];
}

export function toHexColor(color: Rgb): string {
  return `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}
