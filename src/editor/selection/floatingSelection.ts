import { sameRect } from '../drawing/raster';
import type { Rect, SelectionPreview, SelectionResampling } from '../model';
import { resample } from './resample';

function hasVisiblePixel(pixels: Uint8ClampedArray): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) {
      return true;
    }
  }
  return false;
}

/**
 * The pixels lifted from a layer by the Selection Tool, and where they are
 * going. The layer itself is not touched while the selection is moved or
 * resized: the originals stay in `pixels`, so every size is resampled from them
 * (never from an earlier, already scaled result) and cancelling is just
 * returning `rect` to `source`.
 */
export class FloatingSelection {
  /** Where the pixels are now, in canvas pixels. May reach past the canvas. */
  rect: Rect;
  private readonly hasContent: boolean;
  private cache: { mode: SelectionResampling; rect: Rect; pixels: Uint8ClampedArray } | null = null;

  /** `pixels` holds the `source` region of the layer, as it was when the selection was made. */
  constructor(
    readonly layerId: string,
    readonly source: Rect,
    private readonly pixels: Uint8ClampedArray
  ) {
    this.rect = source;
    this.hasContent = hasVisiblePixel(pixels);
  }

  /** The selection moved or changed size, whether or not there is anything to show. */
  get isTransformed(): boolean {
    return !sameRect(this.rect, this.source);
  }

  /** Applying it would change the layer. A selection without visible pixels never does: it creates no artwork. */
  get isPending(): boolean {
    return this.hasContent && this.isTransformed;
  }

  /** The pixels at the size of `rect`. Preview and commit both use this, so they always agree. */
  resampled(mode: SelectionResampling): Uint8ClampedArray {
    const cached = this.cache;
    if (cached !== null && cached.mode === mode && sameRect(cached.rect, this.rect)) {
      return cached.pixels;
    }
    const pixels = resample(this.pixels, this.source.width, this.source.height, this.rect.width, this.rect.height, mode);
    this.cache = { mode, rect: this.rect, pixels };
    return pixels;
  }

  preview(mode: SelectionResampling): SelectionPreview | null {
    if (!this.isPending) {
      return null;
    }
    return { layerId: this.layerId, source: this.source, rect: this.rect, pixels: this.resampled(mode) };
  }
}
