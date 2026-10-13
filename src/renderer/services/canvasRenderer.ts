import { consumeDirty, layerDrawings } from '@editor/drawing/raster';
import type { DrawingData, Frame, SelectionPreview } from '@editor/model';

interface LayerSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  revision: number;
}

/**
 * Draws frames onto a canvas element. Each layer keeps a backing canvas that
 * is updated incrementally (only the changed rectangle is uploaded), so painting
 * stays responsive on large canvases. The renderer only reads editor data.
 */
export class CanvasRenderer {
  private readonly surfaces = new WeakMap<DrawingData, LayerSurface>();
  /** Layer pixels with the selection already moved, built on a canvas of the size of the layer. */
  private composite: HTMLCanvasElement | null = null;
  /** The transformed pixels as an image; rebuilt only when they change, not while they are just dragged. */
  private previewImage: { pixels: Uint8ClampedArray; canvas: HTMLCanvasElement } | null = null;

  constructor(
    private readonly target: HTMLCanvasElement,
    private readonly width: number,
    private readonly height: number
  ) {
    target.width = width;
    target.height = height;
  }

  /**
   * `preview` is a transformation of the selection that is not in the layer yet: the layer is
   * drawn without the original pixels and with the transformed ones instead. The layer is not changed.
   */
  render(frame: Frame, preview: SelectionPreview | null = null): void {
    const context = this.target.getContext('2d');
    if (context === null) {
      return;
    }
    context.clearRect(0, 0, this.width, this.height);
    // Layers are listed top-most first, so paint from the end.
    for (let index = frame.layers.length - 1; index >= 0; index -= 1) {
      const layer = frame.layers[index];
      if (layer === undefined || !layer.visible) {
        continue;
      }
      layerDrawings(layer).forEach((drawing, position) => {
        const surface = this.syncSurface(drawing);
        if (surface === null) {
          return;
        }
        // The pixels of a layer are its first drawing; the curves above them are not selectable.
        const moved = preview !== null && preview.layerId === layer.id && position === 0 ? this.withPreview(surface, preview) : null;
        context.drawImage(moved ?? surface.canvas, 0, 0);
      });
    }
  }

  private withPreview(surface: LayerSurface, preview: SelectionPreview): HTMLCanvasElement | null {
    const composite = (this.composite ??= document.createElement('canvas'));
    composite.width = this.width;
    composite.height = this.height;
    const context = composite.getContext('2d');
    const image = this.previewCanvas(preview);
    if (context === null || image === null) {
      return null;
    }
    context.drawImage(surface.canvas, 0, 0);
    context.clearRect(preview.source.x, preview.source.y, preview.source.width, preview.source.height);
    context.drawImage(image, preview.rect.x, preview.rect.y);
    return composite;
  }

  private previewCanvas(preview: SelectionPreview): HTMLCanvasElement | null {
    if (this.previewImage?.pixels === preview.pixels) {
      return this.previewImage.canvas;
    }
    const canvas = document.createElement('canvas');
    canvas.width = preview.rect.width;
    canvas.height = preview.rect.height;
    const context = canvas.getContext('2d');
    if (context === null) {
      return null;
    }
    context.putImageData(new ImageData(preview.pixels as Uint8ClampedArray<ArrayBuffer>, preview.rect.width, preview.rect.height), 0, 0);
    this.previewImage = { pixels: preview.pixels, canvas };
    return canvas;
  }

  private syncSurface(drawing: DrawingData): LayerSurface | null {
    const data = drawing.data;
    if (data === null) {
      return null;
    }
    let surface = this.surfaces.get(drawing);
    if (surface === undefined) {
      const canvas = document.createElement('canvas');
      canvas.width = drawing.width;
      canvas.height = drawing.height;
      const context = canvas.getContext('2d');
      if (context === null) {
        return null;
      }
      surface = { canvas, context, revision: -1 };
      this.surfaces.set(drawing, surface);
    }
    if (surface.revision !== drawing.revision) {
      const image = new ImageData(data as Uint8ClampedArray<ArrayBuffer>, drawing.width, drawing.height);
      const dirty = surface.revision < 0 ? null : consumeDirty(drawing);
      if (dirty === null) {
        consumeDirty(drawing);
        surface.context.putImageData(image, 0, 0);
      } else {
        surface.context.putImageData(image, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height);
      }
      surface.revision = drawing.revision;
    }
    return surface;
  }
}
