import type { SelectionResampling } from '../model';

/**
 * Scales a non-premultiplied RGBA buffer to `width x height`. `nearest` keeps hard pixel edges;
 * `smooth` interpolates bilinearly with the alpha weighting the colors, so transparent pixels
 * never tint their opaque neighbors. The source is returned as it is when the size is unchanged.
 */
export function resample(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  mode: SelectionResampling
): Uint8ClampedArray {
  if (width === sourceWidth && height === sourceHeight) {
    return source;
  }
  const result = new Uint8ClampedArray(width * height * 4);
  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      if (mode === 'nearest') {
        const column = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * scaleX));
        const row = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * scaleY));
        const from = (row * sourceWidth + column) * 4;
        result.set(source.subarray(from, from + 4), target);
      } else {
        sampleBilinear(source, sourceWidth, sourceHeight, (x + 0.5) * scaleX - 0.5, (y + 0.5) * scaleY - 0.5, result, target);
      }
    }
  }
  return result;
}

/** Writes the bilinear sample at the fractional source position `(sx, sy)` to `result[target..target + 4]`. */
function sampleBilinear(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  sx: number,
  sy: number,
  result: Uint8ClampedArray,
  target: number
): void {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const columns = [Math.min(sourceWidth - 1, Math.max(0, x0)), Math.min(sourceWidth - 1, Math.max(0, x0 + 1))] as const;
  const rows = [Math.min(sourceHeight - 1, Math.max(0, y0)), Math.min(sourceHeight - 1, Math.max(0, y0 + 1))] as const;
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];

  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let tap = 0; tap < 4; tap += 1) {
    const from = ((rows[tap >> 1] as number) * sourceWidth + (columns[tap & 1] as number)) * 4;
    const weight = (weights[tap] as number) * ((source[from + 3] as number) / 255);
    alpha += weight;
    red += weight * (source[from] as number);
    green += weight * (source[from + 1] as number);
    blue += weight * (source[from + 2] as number);
  }
  if (alpha === 0) {
    return;
  }
  result[target] = Math.round(red / alpha);
  result[target + 1] = Math.round(green / alpha);
  result[target + 2] = Math.round(blue / alpha);
  result[target + 3] = Math.round(alpha * 255);
}
