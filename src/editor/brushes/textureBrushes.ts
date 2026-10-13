import type { BrushDefinition } from './brush';
import { clamp01, hash2, smoothstep, valueNoise } from './noise';
import { SegmentStroke } from './painter';

type PencilSettings = { textureIntensity: number; edgeRoughness: number };

/** Fine per-pixel grain and edges eroded in small clumps. */
export const pencilBrush: BrushDefinition<PencilSettings> = {
  id: 'pencil',
  name: 'Textured Pencil',
  options: [
    { key: 'textureIntensity', label: 'Texture Intensity', min: 0, max: 100, unit: '%' },
    { key: 'edgeRoughness', label: 'Edge Roughness', min: 0, max: 100, unit: '%' }
  ],
  defaultSettings: { textureIntensity: 50, edgeRoughness: 30 },
  startStroke(settings, context) {
    const texture = settings.textureIntensity / 100;
    const roughness = settings.edgeRoughness / 100;
    return new SegmentStroke(context, (x, y, coverage, edge) => {
      const grain = 1 - 0.7 * texture * hash2(x, y, context.seed);
      const erosion = 2 * roughness * smoothstep((edge - 0.55) / 0.45) * valueNoise(x, y, 2, context.seed + 1);
      return coverage * grain * clamp01(1 - erosion);
    });
  }
};

type CharcoalSettings = { textureIntensity: number; density: number; edgeSoftness: number };

/** Coarse, cloudy grain with uneven density and edges that fade out. */
export const charcoalBrush: BrushDefinition<CharcoalSettings> = {
  id: 'charcoal',
  name: 'Charcoal Brush',
  options: [
    { key: 'textureIntensity', label: 'Texture Intensity', min: 0, max: 100, unit: '%' },
    { key: 'density', label: 'Density', min: 0, max: 100, unit: '%' },
    { key: 'edgeSoftness', label: 'Edge Softness', min: 0, max: 100, unit: '%' }
  ],
  defaultSettings: { textureIntensity: 70, density: 70, edgeSoftness: 50 },
  startStroke(settings, context) {
    const texture = settings.textureIntensity / 100;
    const density = settings.density / 100;
    const softness = settings.edgeSoftness / 100;
    return new SegmentStroke(context, (x, y, coverage, edge) => {
      const noise = 0.6 * valueNoise(x, y, 3, context.seed) + 0.4 * hash2(x, y, context.seed + 1);
      const fill = clamp01((density - noise) * 4 + 0.5);
      const fade = softness === 0 ? 1 : clamp01((1 - edge) / softness);
      return coverage * fade * (1 - texture + texture * fill);
    });
  }
};

type ChalkSettings = { grainSize: number; textureIntensity: number; coverage: number };

/** Blocky grains with gaps, thinning out towards the edges. */
export const chalkBrush: BrushDefinition<ChalkSettings> = {
  id: 'chalk',
  name: 'Chalk Brush',
  options: [
    { key: 'grainSize', label: 'Grain Size', min: 1, max: 8, unit: 'px' },
    { key: 'textureIntensity', label: 'Texture Intensity', min: 0, max: 100, unit: '%' },
    { key: 'coverage', label: 'Coverage', min: 0, max: 100, unit: '%' }
  ],
  defaultSettings: { grainSize: 2, textureIntensity: 60, coverage: 60 },
  startStroke(settings, context) {
    const { grainSize } = settings;
    const texture = settings.textureIntensity / 100;
    const coverage = settings.coverage / 100;
    return new SegmentStroke(context, (x, y, pixelCoverage, edge) => {
      const grain = hash2(Math.floor(x / grainSize), Math.floor(y / grainSize), context.seed);
      const noise = 0.75 * grain + 0.25 * hash2(x, y, context.seed + 1);
      const fill = clamp01((coverage * (1 - 0.5 * edge * edge) - noise) * 8 + 0.5);
      return pixelCoverage * (1 - texture + texture * fill);
    });
  }
};
