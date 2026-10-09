import '@testing-library/jest-dom/vitest';

// jsdom has no canvas implementation. The editor tests only need the calls to
// be accepted, so a minimal 2D context and `ImageData` are provided.
if (typeof window !== 'undefined') {
  if (typeof globalThis.ImageData === 'undefined') {
    class FakeImageData {
      readonly data: Uint8ClampedArray;
      readonly width: number;
      readonly height: number;
      constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
        if (typeof dataOrWidth === 'number') {
          this.width = dataOrWidth;
          this.height = widthOrHeight;
          this.data = new Uint8ClampedArray(dataOrWidth * widthOrHeight * 4);
        } else {
          this.data = dataOrWidth;
          this.width = widthOrHeight;
          this.height = height ?? 0;
        }
      }
    }
    (globalThis as unknown as { ImageData: unknown }).ImageData = FakeImageData;
  }

  const fakeContext = {
    clearRect: () => undefined,
    drawImage: () => undefined,
    putImageData: () => undefined,
    createImageData: (width: number, height: number) => new ImageData(width, height),
    fillRect: () => undefined
  };
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return fakeContext;
  } as unknown as HTMLCanvasElement['getContext'];
}
