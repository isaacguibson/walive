import { consumeDirty } from '@editor/drawing/raster';
import type { DrawingData, Frame } from '@editor/model';

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

  constructor(
    private readonly target: HTMLCanvasElement,
    private readonly width: number,
    private readonly height: number
  ) {
    target.width = width;
    target.height = height;
  }

  render(frame: Frame): void {
    const context = this.target.getContext('2d');
    if (context === null) {
      return;
    }
    context.clearRect(0, 0, this.width, this.height);
    // Layers are listed top-most first, so paint from the end.
    for (let index = frame.layers.length - 1; index >= 0; index -= 1) {
      const layer = frame.layers[index];
      if (layer === undefined || !layer.visible || layer.drawing.data === null) {
        continue;
      }
      const surface = this.syncSurface(layer.drawing);
      if (surface !== null) {
        context.drawImage(surface.canvas, 0, 0);
      }
    }
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
