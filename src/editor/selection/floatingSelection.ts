import { sameRect } from '../drawing/raster';
import type { Rect, SelectionPreview, SelectionResampling } from '../model';
import { resample, rotate } from './resample';

function hasVisiblePixel(pixels: Uint8ClampedArray): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) {
      return true;
    }
  }
  return false;
}

/** The transformed pixels and the rectangle of the canvas they cover (which may reach past the canvas). */
export interface RenderedSelection {
  rect: Rect;
  pixels: Uint8ClampedArray;
}

/**
 * The pixels lifted from a layer by the Selection Tool, and where they are
 * going. The layer itself is not touched while the selection is moved, resized
 * or rotated: the originals stay in `pixels`, so every size and angle is
 * computed from them (never from an earlier, already transformed result) and
 * cancelling is just returning `rect` to `source` and `angle` to zero.
 */
export class FloatingSelection {
  /** Where the pixels are now before rotation, in canvas pixels. May reach past the canvas. */
  rect: Rect;
  /** Degrees clockwise around the center of `rect`. */
  angle = 0;
  private readonly hasContent: boolean;
  private cache: { mode: SelectionResampling; rect: Rect; angle: number; result: RenderedSelection } | null = null;

  /** `pixels` holds the `source` region of the layer, as it was when the selection was made. */
  constructor(
    readonly layerId: string,
    readonly source: Rect,
    private readonly pixels: Uint8ClampedArray
  ) {
    this.rect = source;
    this.hasContent = hasVisiblePixel(pixels);
  }

  /** The selection moved, changed size or turned, whether or not there is anything to show. */
  get isTransformed(): boolean {
    return !sameRect(this.rect, this.source) || this.angle !== 0;
  }

  /** Applying it would change the layer. A selection without visible pixels never does: it creates no artwork. */
  get isPending(): boolean {
    return this.hasContent && this.isTransformed;
  }

  /** The pixels at the size and angle of the selection. Preview and commit both use this, so they always agree. */
  rendered(mode: SelectionResampling): RenderedSelection {
    const cached = this.cache;
    if (cached !== null && cached.mode === mode && cached.angle === this.angle && sameRect(cached.rect, this.rect)) {
      return cached.result;
    }
    const scaled = resample(this.pixels, this.source.width, this.source.height, this.rect.width, this.rect.height, mode);
    let result: RenderedSelection = { rect: this.rect, pixels: scaled };
    if (this.angle !== 0) {
      const turned = rotate(scaled, this.rect.width, this.rect.height, this.angle, mode);
      result = {
        pixels: turned.pixels,
        rect: {
          x: this.rect.x + (this.rect.width - turned.width) / 2,
          y: this.rect.y + (this.rect.height - turned.height) / 2,
          width: turned.width,
          height: turned.height
        }
      };
    }
    this.cache = { mode, rect: this.rect, angle: this.angle, result };
    return result;
  }

  preview(mode: SelectionResampling): SelectionPreview | null {
    if (!this.isPending) {
      return null;
    }
    const { rect, pixels } = this.rendered(mode);
    return { layerId: this.layerId, source: this.source, rect, pixels };
  }
}
