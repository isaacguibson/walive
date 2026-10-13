import { describe, expect, it } from 'vitest';
import { framesFromAnimationDocument } from '@editor/animation/serialization';
import { BRUSHES, DEFAULT_BRUSH_ID, findBrush, sanitizeBrushSettings } from '@editor/brushes/registry';
import { compositePixel, getPixel } from '@editor/drawing/raster';
import type { BrushId } from '@editor/model';
import { makeSession } from './helpers';

const SIZE = 64;
type Session = ReturnType<typeof makeSession>;
type Path = readonly (readonly [number, number])[];

const LINE: Path = [
  [8.5, 32.5],
  [30.5, 32.5],
  [55.5, 32.5]
];
const ALL_BRUSHES: readonly BrushId[] = ['basic', 'pencil', 'charcoal', 'chalk', 'particle'];

function newSession(seed = 1): Session {
  return makeSession({ width: SIZE, height: SIZE, strokeSeed: () => seed });
}

function draw(session: Session, path: Path, pointer: { pointerType?: string; pressure?: number } = {}): void {
  path.forEach(([x, y], index) => {
    const event = { x, y, pointerId: 1, ...pointer };
    if (index === 0) {
      session.pointerDown({ ...event, buttons: 1 });
    } else if (index === path.length - 1) {
      session.pointerUp({ ...event, buttons: 0 });
    } else {
      session.pointerMove({ ...event, buttons: 1 });
    }
  });
}

function pixels(session: Session): number[] {
  return Array.from(session.getSnapshot().activeLayer.drawing.data ?? []);
}

function alphaAt(session: Session, x: number, y: number): number {
  return getPixel(session.getSnapshot().activeLayer.drawing, x, y)[3];
}

function paintedPixels(session: Session): number {
  return pixels(session).filter((value, index) => index % 4 === 3 && value !== 0).length;
}

/** Mean alpha of the interior of a horizontal stroke. */
function meanCoreAlpha(session: Session): number {
  let total = 0;
  let count = 0;
  for (let y = 28; y <= 36; y += 1) {
    for (let x = 14; x <= 50; x += 1) {
      total += alphaAt(session, x, y);
      count += 1;
    }
  }
  return total / count;
}

function brushSession(type: BrushId, seed = 1, size = 16): Session {
  const session = newSession(seed);
  session.setBrushType(type);
  session.setBrushSize(size);
  return session;
}

function strokeWith(type: BrushId, seed = 1, path: Path = LINE): Session {
  const session = brushSession(type, seed);
  draw(session, path);
  return session;
}

describe('brush registry', () => {
  it('registers the five brush types with unique ids, in display order', () => {
    expect(BRUSHES.map((brush) => brush.name)).toEqual([
      'Basic Brush',
      'Textured Pencil',
      'Charcoal Brush',
      'Chalk Brush',
      'Particle Brush'
    ]);
    expect(BRUSHES.map((brush) => brush.id)).toEqual(ALL_BRUSHES);
    expect(DEFAULT_BRUSH_ID).toBe('basic');
  });

  it('exposes the brush-specific options of every type', () => {
    const labels = (id: BrushId): string[] => findBrush(id).options.map((option) => option.label);
    expect(labels('basic')).toEqual([]);
    expect(labels('pencil')).toEqual(['Texture Intensity', 'Edge Roughness']);
    expect(labels('charcoal')).toEqual(['Texture Intensity', 'Density', 'Edge Softness']);
    expect(labels('chalk')).toEqual(['Grain Size', 'Texture Intensity', 'Coverage']);
    expect(labels('particle')).toEqual(['Particle Size', 'Spacing', 'Scatter', 'Size Variation']);
  });

  it('keeps every default within its option range', () => {
    for (const brush of BRUSHES) {
      for (const option of brush.options) {
        expect(brush.defaultSettings[option.key]).toBeGreaterThanOrEqual(option.min);
        expect(brush.defaultSettings[option.key]).toBeLessThanOrEqual(option.max);
      }
    }
  });

  it('falls back to the Basic Brush for unknown types', () => {
    expect(findBrush('airbrush-from-the-future').id).toBe('basic');
  });

  it('replaces missing and invalid settings by defaults and clamps out-of-range ones', () => {
    const chalk = findBrush('chalk');
    expect(sanitizeBrushSettings(chalk, undefined)).toEqual(chalk.defaultSettings);
    expect(sanitizeBrushSettings(chalk, 'invalid')).toEqual(chalk.defaultSettings);
    expect(sanitizeBrushSettings(chalk, { grainSize: 99, textureIntensity: Number.NaN, coverage: '40', extra: 1 })).toEqual({
      grainSize: 8,
      textureIntensity: 60,
      coverage: 60
    });
    expect(sanitizeBrushSettings(chalk, { grainSize: 3.6, coverage: -5 })).toMatchObject({ grainSize: 4, coverage: 0 });
  });
});

describe('brush selection and settings', () => {
  it('starts with the Basic Brush, full opacity and the Brush tool selected', () => {
    const { state } = newSession().getSnapshot();
    expect(state.selectedTool).toBe('brush');
    expect(state.brushType).toBe('basic');
    expect(state.brushOpacity).toBe(100);
    expect(state.brushSettings).toEqual({});
  });

  it('changes the brush type without changing the tool or touching existing strokes', () => {
    const session = strokeWith('basic');
    const before = pixels(session);
    session.setBrushType('chalk');
    expect(session.getSnapshot().state.brushType).toBe('chalk');
    expect(session.getSnapshot().state.selectedTool).toBe('brush');
    expect(pixels(session)).toEqual(before);
  });

  it('keeps the last-used settings of each brush type', () => {
    const session = newSession();
    session.setBrushType('pencil');
    session.setBrushSetting('textureIntensity', 90);
    session.setBrushType('chalk');
    session.setBrushSetting('grainSize', 5);
    expect(session.getSnapshot().state.brushSettings).toMatchObject({ grainSize: 5, coverage: 60 });

    session.setBrushType('pencil');
    expect(session.getSnapshot().state.brushSettings).toEqual({ textureIntensity: 90, edgeRoughness: 30 });
    session.setBrushType('chalk');
    expect(session.getSnapshot().state.brushSettings).toMatchObject({ grainSize: 5 });
  });

  it('clamps setting values, ignores unknown keys and recovers from unknown brush types', () => {
    const session = newSession();
    session.setBrushType('particle');
    session.setBrushSetting('spacing', 5000);
    session.setBrushSetting('scatter', -4);
    session.setBrushSetting('notAnOption', 3);
    expect(session.getSnapshot().state.brushSettings).toEqual({
      particleSize: 25,
      spacing: 200,
      scatter: 0,
      sizeVariation: 40
    });
    session.setBrushType('unknown');
    expect(session.getSnapshot().state.brushType).toBe('basic');
  });

  it('keeps the brush opacity within 0 to 100', () => {
    const session = newSession();
    session.setBrushOpacity(42.4);
    expect(session.getSnapshot().state.brushOpacity).toBe(42);
    session.setBrushOpacity(250);
    expect(session.getSnapshot().state.brushOpacity).toBe(100);
    session.setBrushOpacity(-3);
    expect(session.getSnapshot().state.brushOpacity).toBe(0);
    session.setBrushOpacity(Number.NaN);
    expect(session.getSnapshot().state.brushOpacity).toBe(0);
  });

  it('applies setting changes only to later strokes', () => {
    const reference = brushSession('chalk');
    draw(reference, LINE);

    const session = brushSession('chalk');
    session.pointerDown({ x: LINE[0]![0], y: LINE[0]![1], pointerId: 1, buttons: 1 });
    session.setBrushSetting('coverage', 5);
    session.setBrushSetting('grainSize', 8);
    session.pointerMove({ x: LINE[1]![0], y: LINE[1]![1], pointerId: 1, buttons: 1 });
    session.pointerUp({ x: LINE[2]![0], y: LINE[2]![1], pointerId: 1, buttons: 0 });
    expect(pixels(session)).toEqual(pixels(reference));
  });
});

describe('brush appearance', () => {
  it('draws the Basic Brush as a solid, continuous stroke', () => {
    const session = strokeWith('basic');
    expect(meanCoreAlpha(session)).toBe(255);
    expect(getPixel(session.getSnapshot().activeLayer.drawing, 20, 32)).toEqual([0, 0, 0, 255]);
  });

  it('draws visibly textured strokes with the configured color', () => {
    for (const type of ['pencil', 'charcoal', 'chalk'] as const) {
      const session = brushSession(type);
      session.setColor('#ff0000');
      draw(session, LINE);
      expect(meanCoreAlpha(session), type).toBeLessThan(255);
      expect(meanCoreAlpha(session), type).toBeGreaterThan(60);
      const [red, green, blue] = getPixel(session.getSnapshot().activeLayer.drawing, 30, 32);
      expect([red, green, blue], type).toEqual([255, 0, 0]);
    }
  });

  it('makes the textured brushes distinguishable from each other and from the Basic Brush', () => {
    const results = ALL_BRUSHES.filter((type) => type !== 'particle').map((type) => pixels(strokeWith(type)));
    for (let first = 0; first < results.length; first += 1) {
      for (let second = first + 1; second < results.length; second += 1) {
        expect(results[first]).not.toEqual(results[second]);
      }
    }
    const [pencil, charcoal, chalk] = (['pencil', 'charcoal', 'chalk'] as const).map((type) => meanCoreAlpha(strokeWith(type)));
    expect(new Set([pencil, charcoal, chalk]).size).toBe(3);
  });

  it('shows more texture with a higher Texture Intensity', () => {
    const light = brushSession('pencil');
    light.setBrushSetting('textureIntensity', 0);
    draw(light, LINE);
    const strong = brushSession('pencil');
    strong.setBrushSetting('textureIntensity', 100);
    draw(strong, LINE);
    expect(meanCoreAlpha(light)).toBe(255);
    expect(meanCoreAlpha(strong)).toBeLessThan(meanCoreAlpha(light));
  });

  it('fills more of a chalk stroke with a higher Coverage', () => {
    const sparse = brushSession('chalk');
    sparse.setBrushSetting('coverage', 20);
    draw(sparse, LINE);
    const dense = brushSession('chalk');
    dense.setBrushSetting('coverage', 90);
    draw(dense, LINE);
    expect(meanCoreAlpha(dense)).toBeGreaterThan(meanCoreAlpha(sparse));
  });

  it('softens charcoal edges with a higher Edge Softness', () => {
    const hard = brushSession('charcoal');
    hard.setBrushSetting('edgeSoftness', 0);
    hard.setBrushSetting('textureIntensity', 0);
    draw(hard, LINE);
    const soft = brushSession('charcoal');
    soft.setBrushSetting('edgeSoftness', 100);
    soft.setBrushSetting('textureIntensity', 0);
    draw(soft, LINE);
    // Row 38 is close to the outer edge of a 16 px stroke centered on row 32.
    expect(alphaAt(hard, 30, 38)).toBe(255);
    expect(alphaAt(soft, 30, 38)).toBeLessThan(120);
  });

  it('does not leave gaps in continuous brushes when the pointer moves fast', () => {
    for (const type of ['basic', 'pencil', 'charcoal', 'chalk'] as const) {
      const session = brushSession(type);
      draw(session, [
        [2.5, 32.5],
        [61.5, 32.5]
      ]);
      for (let x = 4; x <= 60; x += 4) {
        const column = Array.from({ length: 17 }, (_, row) => alphaAt(session, x, 24 + row));
        expect(Math.max(...column), `${type} column ${x}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('particle brush', () => {
  it('places particles by distance, whatever the pointer event rate', () => {
    const sparse = brushSession('particle');
    draw(sparse, [
      [8.5, 32.5],
      [55.5, 32.5]
    ]);
    const dense = brushSession('particle');
    draw(
      dense,
      Array.from({ length: 48 }, (_, index) => [8.5 + index, 32.5] as const)
    );
    expect(pixels(dense)).toEqual(pixels(sparse));
  });

  it('keeps particles on the path with no scatter and spreads them with scatter', () => {
    const tight = brushSession('particle');
    tight.setBrushSetting('scatter', 0);
    draw(tight, LINE);
    const loose = brushSession('particle');
    loose.setBrushSetting('scatter', 100);
    draw(loose, LINE);

    const farFromPath = (session: Session): number =>
      Array.from({ length: SIZE }, (_, x) => alphaAt(session, x, 32 - 7) + alphaAt(session, x, 32 + 7)).reduce(
        (sum, value) => sum + value,
        0
      );
    expect(farFromPath(tight)).toBe(0);
    expect(farFromPath(loose)).toBeGreaterThan(0);
  });

  it('draws fewer marks with a larger Spacing', () => {
    const close = brushSession('particle');
    close.setBrushSetting('spacing', 20);
    draw(close, LINE);
    const wide = brushSession('particle');
    wide.setBrushSetting('spacing', 200);
    draw(wide, LINE);
    expect(paintedPixels(wide)).toBeLessThan(paintedPixels(close));
  });

  it('draws bigger marks with a larger Particle Size', () => {
    const small = brushSession('particle');
    small.setBrushSetting('particleSize', 10);
    small.setBrushSetting('scatter', 0);
    draw(small, LINE);
    const large = brushSession('particle');
    large.setBrushSetting('particleSize', 90);
    large.setBrushSetting('scatter', 0);
    draw(large, LINE);
    expect(paintedPixels(large)).toBeGreaterThan(paintedPixels(small));
  });
});

describe('deterministic rendering', () => {
  it('reproduces the same stroke for the same seed and path', () => {
    for (const type of ALL_BRUSHES) {
      expect(pixels(strokeWith(type, 5)), type).toEqual(pixels(strokeWith(type, 5)));
    }
  });

  it('gives different strokes different grain', () => {
    for (const type of ['pencil', 'charcoal', 'chalk', 'particle'] as const) {
      expect(pixels(strokeWith(type, 5)), type).not.toEqual(pixels(strokeWith(type, 6)));
    }
  });

  it('does not depend on the zoom level', () => {
    for (const type of ALL_BRUSHES) {
      const zoomed = brushSession(type);
      zoomed.setZoom(400);
      draw(zoomed, LINE);
      expect(pixels(zoomed), type).toEqual(pixels(strokeWith(type)));
    }
  });
});

describe('opacity, pressure and stabilization', () => {
  it('uses the base opacity for every brush and never stacks overlapping segments', () => {
    const basic = brushSession('basic');
    basic.setBrushOpacity(50);
    draw(basic, LINE);
    expect(alphaAt(basic, 30, 32)).toBe(128);

    const chalk = brushSession('chalk');
    chalk.setBrushSetting('textureIntensity', 0);
    chalk.setBrushOpacity(50);
    draw(chalk, LINE);
    expect(alphaAt(chalk, 30, 32)).toBe(128);
  });

  it('composites translucent strokes over existing pixels', () => {
    const session = brushSession('basic');
    draw(session, LINE);
    session.setColor('#ffffff');
    session.setBrushOpacity(50);
    draw(session, LINE);
    const [red, , , alpha] = getPixel(session.getSnapshot().activeLayer.drawing, 30, 32);
    expect(alpha).toBe(255);
    expect(red).toBeGreaterThan(100);
    expect(red).toBeLessThan(155);
  });

  it('combines the base opacity with pen pressure for opacity', () => {
    const session = brushSession('basic');
    session.setBrushOpacity(50);
    session.setUsePenPressureOpacity(true);
    draw(session, LINE, { pointerType: 'pen', pressure: 1 });
    expect(alphaAt(session, 30, 32)).toBe(128);

    const light = brushSession('basic');
    light.setBrushOpacity(50);
    light.setUsePenPressureOpacity(true);
    draw(light, LINE, { pointerType: 'pen', pressure: 0.2 });
    expect(alphaAt(light, 30, 32)).toBeGreaterThan(0);
    expect(alphaAt(light, 30, 32)).toBeLessThan(128);
  });

  it('applies pen pressure to the size and opacity of every brush type', () => {
    for (const type of ALL_BRUSHES) {
      const light = brushSession(type);
      light.setUsePenPressure(true);
      draw(light, LINE, { pointerType: 'pen', pressure: 0.2 });
      const heavy = brushSession(type);
      heavy.setUsePenPressure(true);
      draw(heavy, LINE, { pointerType: 'pen', pressure: 1 });
      expect(paintedPixels(heavy), type).toBeGreaterThan(paintedPixels(light));
    }
  });

  it('draws at the configured size and opacity for the mouse, even when it reports a default pressure', () => {
    for (const type of ALL_BRUSHES) {
      const session = brushSession(type);
      session.setUsePenPressure(true);
      session.setUsePenPressureOpacity(true);
      draw(session, LINE, { pointerType: 'mouse', pressure: 0.5 });
      expect(meanCoreAlpha(session), type).toBe(meanCoreAlpha(strokeWith(type)));
    }
  });

  it('works with stroke stabilization', () => {
    for (const type of ALL_BRUSHES) {
      const session = brushSession(type);
      session.setStabilizeStroke(true);
      draw(session, LINE);
      expect(paintedPixels(session), type).toBeGreaterThan(0);
    }
  });

  it('is not affected by the brush type when erasing', () => {
    const session = strokeWith('chalk');
    session.selectTool('eraser');
    session.setEraserSize(30);
    draw(session, LINE);
    expect(paintedPixels(session)).toBe(0);
  });
});

describe('stroke persistence', () => {
  const reopen = (session: Session) =>
    framesFromAnimationDocument(session.createSaveRequest().document, SIZE, SIZE)[0]!.layers[0]!.drawing;

  it('preserves the appearance of every brush type through undo/redo, save/reopen, duplication and export', () => {
    for (const type of ALL_BRUSHES) {
      const session = strokeWith(type);
      const expected = pixels(session);
      expect(expected.some((value) => value !== 0), type).toBe(true);

      session.undo();
      expect(paintedPixels(session), type).toBe(0);
      session.redo();
      expect(pixels(session), type).toEqual(expected);

      expect(Array.from(reopen(session).data ?? []), type).toEqual(expected);

      const source = session.getSnapshot().activeFrame;
      session.duplicateFrame(source.id);
      expect(session.getSnapshot().activeFrame.id).not.toBe(source.id);
      expect(pixels(session), type).toEqual(expected);

      const [original, copy] = session.getSnapshot().frames;
      for (const [x, y] of [[20, 32], [30, 30], [45, 34]] as const) {
        expect(compositePixel(copy!.layers, x, y), type).toEqual(compositePixel(original!.layers, x, y));
      }
    }
  });

  it('draws on the active layer and frame only', () => {
    const session = newSession();
    session.addLayer();
    const [top, bottom] = session.getSnapshot().activeFrame.layers;
    session.selectLayer(bottom!.id);
    session.setBrushType('charcoal');
    draw(session, LINE);
    const layers = session.getSnapshot().activeFrame.layers;
    expect(layers.find((layer) => layer.id === top!.id)!.drawing.data).toBeNull();
    expect(layers.find((layer) => layer.id === bottom!.id)!.drawing.data).not.toBeNull();
  });
});
