import type { BrushDefinition, BrushSample, BrushStroke } from './brush';
import { hash2 } from './noise';
import { StrokePainter } from './painter';

/** Particles are never closer than this, which bounds how many a stroke can produce. */
const MIN_SPACING = 0.5;

type ParticleSettings = { particleSize: number; spacing: number; scatter: number; sizeVariation: number };

/** Scattered marks placed at regular distances along the path, whatever the event rate. */
export const particleBrush: BrushDefinition<ParticleSettings> = {
  id: 'particle',
  name: 'Particle Brush',
  options: [
    { key: 'particleSize', label: 'Particle Size', min: 5, max: 100, unit: '%' },
    { key: 'spacing', label: 'Spacing', min: 5, max: 200, unit: '%' },
    { key: 'scatter', label: 'Scatter', min: 0, max: 100, unit: '%' },
    { key: 'sizeVariation', label: 'Size Variation', min: 0, max: 100, unit: '%' }
  ],
  defaultSettings: { particleSize: 25, spacing: 30, scatter: 60, sizeVariation: 40 },
  startStroke: (settings, context) => new ParticleStroke(settings, new StrokePainter(context, true), context.seed)
};

class ParticleStroke implements BrushStroke {
  private last: BrushSample | null = null;
  /** Distance, along the next segment, to the next particle. */
  private gap = 0;
  private count = 0;

  constructor(
    private readonly settings: ParticleSettings,
    private readonly painter: StrokePainter,
    private readonly seed: number
  ) {}

  begin(sample: BrushSample): void {
    this.last = sample;
    this.place(sample);
    this.gap = this.spacing(sample);
  }

  extend(sample: BrushSample): void {
    const from = this.last ?? sample;
    const length = Math.hypot(sample.x - from.x, sample.y - from.y);
    let distance = this.gap;
    while (distance <= length) {
      const at = interpolate(from, sample, distance / length);
      this.place(at);
      distance += this.spacing(at);
    }
    this.gap = distance - length;
    this.last = sample;
  }

  end(): void {
    this.last = null;
    this.painter.release();
  }

  private spacing(sample: BrushSample): number {
    return Math.max(MIN_SPACING, (sample.size * this.settings.spacing) / 100);
  }

  /** Every random choice depends only on the seed and the particle's index along the stroke. */
  private place(sample: BrushSample): void {
    const index = this.count;
    this.count += 1;
    const angle = hash2(index, 1, this.seed) * 2 * Math.PI;
    const reach = (Math.sqrt(hash2(index, 2, this.seed)) * this.settings.scatter * sample.size) / 200;
    const shrink = (this.settings.sizeVariation / 100) * hash2(index, 3, this.seed);
    const particle: BrushSample = {
      x: sample.x + Math.cos(angle) * reach,
      y: sample.y + Math.sin(angle) * reach,
      size: Math.max(1, (sample.size * this.settings.particleSize * (1 - shrink)) / 100),
      opacity: sample.opacity
    };
    this.painter.paint(particle, particle);
  }
}

function interpolate(from: BrushSample, to: BrushSample, t: number): BrushSample {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    size: from.size + (to.size - from.size) * t,
    opacity: from.opacity + (to.opacity - from.opacity) * t
  };
}
