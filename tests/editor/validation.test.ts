import { describe, expect, it } from 'vitest';
import { MAX_FPS, MAX_ZOOM, MIN_ZOOM } from '@editor/constants';
import { DEFAULT_SHORTCUTS, matchShortcut, type KeyEventLike } from '@editor/shortcuts/shortcuts';
import { computeFitZoom, screenToCanvas, zoomFromWheel } from '@editor/viewport';
import { parseFps, parseHexColor, parseToolSize, parseZoom, toHexColor } from '@editor/validation';
import { makeSession } from './helpers';

describe('FPS validation', () => {
  it('accepts positive integers, including the presets', () => {
    for (const value of [1, 24, 30, 60, 120, '24', ' 48 ', MAX_FPS]) {
      expect(parseFps(value), String(value)).toBe(Number(String(value).trim()));
    }
  });

  it('rejects zero, negatives, decimals, empty and non-numeric values', () => {
    for (const value of [0, -1, 1.5, '0', '-1', '1.5', 'abc', '', '  ', '1e2', MAX_FPS + 1, Number.NaN]) {
      expect(parseFps(value), String(value)).toBeNull();
    }
  });

  it('is enforced by the session and keeps the previous value', () => {
    const session = makeSession();
    expect(session.getSnapshot().state.fps).toBe(24);
    for (const value of ['0', '-3', '1.5', 'abc', '']) {
      expect(session.setFps(value)).toBe(false);
    }
    expect(session.getSnapshot().state.fps).toBe(24);
    expect(session.setFps('60')).toBe(true);
    expect(session.getSnapshot().state.fps).toBe(60);
  });
});

describe('zoom validation', () => {
  it('accepts values greater than zero and clamps them to the supported range', () => {
    expect(parseZoom('150')).toBe(150);
    expect(parseZoom(50)).toBe(50);
    expect(parseZoom('100000')).toBe(MAX_ZOOM);
    expect(parseZoom('0.1')).toBe(MIN_ZOOM);
  });

  it('rejects zero, negative, empty and non-numeric values', () => {
    for (const value of [0, -1, '0', '-5', '', 'abc', '1,5', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseZoom(value), String(value)).toBeNull();
    }
  });

  it('is enforced by the session', () => {
    const session = makeSession();
    expect(session.getSnapshot().state.zoom).toBe(100);
    expect(session.setZoom('0')).toBe(false);
    expect(session.setZoom('abc')).toBe(false);
    expect(session.getSnapshot().state.zoom).toBe(100);
    expect(session.setZoom('250')).toBe(true);
    expect(session.getSnapshot().state.zoom).toBe(250);
  });
});

describe('tool option validation', () => {
  it('validates sizes and colors', () => {
    expect(parseToolSize('8')).toBe(8);
    expect(parseToolSize('0')).toBeNull();
    expect(parseToolSize('2.5')).toBeNull();
    expect(parseHexColor('#FF8000')).toEqual([255, 128, 0]);
    expect(parseHexColor('red')).toBeNull();
    expect(toHexColor([255, 128, 0])).toBe('#ff8000');
  });

  it('keeps previous session values for invalid input', () => {
    const session = makeSession();
    expect(session.setBrushSize('0')).toBe(false);
    expect(session.setEraserSize('x')).toBe(false);
    expect(session.setColor('blue')).toBe(false);
    const { state } = session.getSnapshot();
    expect([state.brushSize, state.eraserSize, state.color]).toEqual([12, 20, '#000000']);
  });
});

function key(value: string, modifiers: Partial<KeyEventLike> = {}): KeyEventLike {
  return { key: value, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers };
}

describe('keyboard shortcuts', () => {
  it('maps the documented shortcuts', () => {
    expect(matchShortcut(key('c', { ctrlKey: true }))).toBe('frame.copy');
    expect(matchShortcut(key('v', { ctrlKey: true }))).toBe('frame.paste');
    expect(matchShortcut(key('x', { ctrlKey: true }))).toBe('frame.cut');
    expect(matchShortcut(key('d', { ctrlKey: true }))).toBe('frame.duplicate');
    expect(matchShortcut(key('w', { ctrlKey: true }))).toBe('frame.next');
    expect(matchShortcut(key('a', { ctrlKey: true }))).toBe('frame.previous');
    expect(matchShortcut(key(' '))).toBe('playback.toggle');
    expect(matchShortcut(key('Space'))).toBe('playback.toggle');
    expect(matchShortcut(key('z', { ctrlKey: true }))).toBe('history.undo');
    expect(matchShortcut(key('z', { ctrlKey: true, shiftKey: true }))).toBe('history.redo');
    expect(matchShortcut(key('s', { ctrlKey: true }))).toBe('project.save');
  });

  it('accepts the Command key and upper-case letters', () => {
    expect(matchShortcut(key('C', { metaKey: true }))).toBe('frame.copy');
  });

  it('ignores keys without the modifier or with extra modifiers', () => {
    expect(matchShortcut(key('c'))).toBeNull();
    expect(matchShortcut(key('c', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchShortcut(key('q', { ctrlKey: true }))).toBeNull();
  });

  it('uses a table with unique bindings', () => {
    const bindings = DEFAULT_SHORTCUTS.map((shortcut) => `${shortcut.modifiers.slice().sort().join('+')}+${shortcut.key}`);
    expect(new Set(bindings).size).toBe(bindings.length);
  });
});

describe('viewport math', () => {
  it('converts screen positions to canvas pixels at any zoom', () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 };
    expect(screenToCanvas(110, 70, rect, 100, 50)).toEqual({ x: 50, y: 25 });
    expect(screenToCanvas(10, 20, rect, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(screenToCanvas(10, 20, { left: 0, top: 0, width: 0, height: 0 }, 100, 50)).toBeNull();
  });

  it('zooms in when scrolling up and out when scrolling down, within limits', () => {
    expect(zoomFromWheel(100, -100)).toBeGreaterThan(100);
    expect(zoomFromWheel(100, 100)).toBeLessThan(100);
    expect(zoomFromWheel(100, 0)).toBe(100);
    expect(zoomFromWheel(MAX_ZOOM, -100)).toBe(MAX_ZOOM);
    expect(zoomFromWheel(MIN_ZOOM, 100)).toBe(MIN_ZOOM);
    expect(zoomFromWheel(100, -1)).toBe(101);
  });

  it('computes a fit zoom that never enlarges past 100%', () => {
    expect(computeFitZoom(1000, 800, 1920, 1080)).toBe(49);
    expect(computeFitZoom(1000, 800, 100, 100)).toBe(100);
    expect(computeFitZoom(10, 10, 100, 100)).toBe(100);
  });
});
