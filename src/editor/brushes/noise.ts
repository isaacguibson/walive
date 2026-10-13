/** Deterministic hash of integer coordinates and a seed, uniformly distributed in `[0, 1)`. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise in `[0, 1)` whose features measure about `cell` pixels. */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smoothstep(fx - x0);
  const ty = smoothstep(fy - y0);
  const top = hash2(x0, y0, seed) * (1 - tx) + hash2(x0 + 1, y0, seed) * tx;
  const bottom = hash2(x0, y0 + 1, seed) * (1 - tx) + hash2(x0 + 1, y0 + 1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}

export function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
