const BINS = 1 << 15;

export interface IndexedImage {
  /** Palette index of every pixel. */
  indices: Uint8Array;
  /** RGB triplets, padded to `2 ** bits` entries. */
  palette: Uint8Array;
  bits: number;
  /** Palette entry reserved for transparent pixels, if any. */
  transparentIndex: number | null;
}

interface Bin {
  key: number;
  count: number;
}

const channelOf = (key: number, channel: number): number => (key >> (10 - channel * 5)) & 31;

function binKey(red: number, green: number, blue: number): number {
  return ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
}

/** Splits `bins` in two at the weighted median of its widest color channel. */
function splitBins(bins: Bin[]): [Bin[], Bin[]] {
  let widest = 0;
  let widestRange = -1;
  for (let channel = 0; channel < 3; channel += 1) {
    const values = bins.map((bin) => channelOf(bin.key, channel));
    const range = Math.max(...values) - Math.min(...values);
    if (range > widestRange) {
      widest = channel;
      widestRange = range;
    }
  }
  const sorted = [...bins].sort((a, b) => channelOf(a.key, widest) - channelOf(b.key, widest));
  const half = sorted.reduce((total, bin) => total + bin.count, 0) / 2;
  let running = 0;
  let cut = 0;
  while (cut < sorted.length - 1) {
    running += (sorted[cut] as Bin).count;
    cut += 1;
    if (running >= half) {
      break;
    }
  }
  return [sorted.slice(0, cut), sorted.slice(cut)];
}

/**
 * Reduces RGBA pixels to at most `maxColors` colors with median cut over a 5-bit-per-channel
 * histogram. When `transparent` is set, pixels with alpha below 128 map to a reserved entry.
 */
export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, transparent: boolean): IndexedImage {
  const counts = new Uint32Array(BINS);
  const sums = new Float64Array(BINS * 3);
  const pixelCount = rgba.length / 4;
  const keys = new Uint16Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const red = rgba[offset] as number;
    const green = rgba[offset + 1] as number;
    const blue = rgba[offset + 2] as number;
    const key = binKey(red, green, blue);
    keys[pixel] = key;
    if (transparent && (rgba[offset + 3] as number) < 128) {
      continue;
    }
    counts[key] = (counts[key] as number) + 1;
    sums[key * 3] = (sums[key * 3] as number) + red;
    sums[key * 3 + 1] = (sums[key * 3 + 1] as number) + green;
    sums[key * 3 + 2] = (sums[key * 3 + 2] as number) + blue;
  }

  const used: Bin[] = [];
  counts.forEach((count, key) => {
    if (count > 0) {
      used.push({ key, count });
    }
  });
  const limit = maxColors - (transparent ? 1 : 0);
  const boxes: Bin[][] = used.length > 0 ? [used] : [];
  while (boxes.length < limit) {
    let candidate = -1;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index] as Bin[];
      if (box.length > 1 && (candidate < 0 || population(box) > population(boxes[candidate] as Bin[]))) {
        candidate = index;
      }
    }
    if (candidate < 0) {
      break;
    }
    boxes.splice(candidate, 1, ...splitBins(boxes[candidate] as Bin[]));
  }

  const colorCount = boxes.length + (transparent ? 1 : 0);
  const bits = Math.max(1, Math.ceil(Math.log2(colorCount)));
  const palette = new Uint8Array((1 << bits) * 3);
  const indexOfBin = new Uint8Array(BINS);
  boxes.forEach((box, index) => {
    const total = population(box);
    for (let channel = 0; channel < 3; channel += 1) {
      const sum = box.reduce((acc, bin) => acc + (sums[bin.key * 3 + channel] as number), 0);
      palette[index * 3 + channel] = Math.round(sum / total);
    }
    box.forEach((bin) => {
      indexOfBin[bin.key] = index;
    });
  });

  const transparentIndex = transparent ? boxes.length : null;
  const indices = new Uint8Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const alpha = rgba[pixel * 4 + 3] as number;
    indices[pixel] = transparentIndex !== null && alpha < 128 ? transparentIndex : (indexOfBin[keys[pixel] as number] as number);
  }
  return { indices, palette, bits, transparentIndex };
}

function population(box: readonly Bin[]): number {
  return box.reduce((total, bin) => total + bin.count, 0);
}
