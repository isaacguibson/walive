import { quantize } from './palette';

export interface GifSettings {
  width: number;
  height: number;
  /** Repeat forever; otherwise the animation plays once. */
  loop: boolean;
  maxColors: number;
  /** Pixels with alpha below 50% become transparent; the rest are fully opaque. */
  transparent: boolean;
}

const MAX_CODE_BITS = 12;
const MAX_CODES = 1 << MAX_CODE_BITS;
/** Frames drawn over a transparent background must clear the previous one. */
const DISPOSE_TO_BACKGROUND = 2;
const DISPOSE_NONE = 1;

class ByteBuffer {
  private bytes = new Uint8Array(1 << 16);
  length = 0;

  push(value: number): void {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length] = value;
    this.length += 1;
  }

  toBuffer(): Buffer {
    return Buffer.from(this.bytes.buffer, 0, this.length);
  }
}

/** GIF flavor of LZW (variable code width up to 12 bits, clear and end codes). */
function lzwEncode(indices: Uint8Array, minCodeSize: number): Buffer {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const output = new ByteBuffer();
  let pending = 0;
  let pendingBits = 0;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let table = new Map<number, number>();

  const emit = (code: number): void => {
    pending |= code << pendingBits;
    pendingBits += codeSize;
    while (pendingBits >= 8) {
      output.push(pending & 0xff);
      pending >>>= 8;
      pendingBits -= 8;
    }
  };

  emit(clearCode);
  let prefix = indices[0] as number;
  for (let position = 1; position < indices.length; position += 1) {
    const next = indices[position] as number;
    const key = (prefix << 8) | next;
    const known = table.get(key);
    if (known !== undefined) {
      prefix = known;
      continue;
    }
    emit(prefix);
    if (nextCode === MAX_CODES) {
      emit(clearCode);
      table = new Map();
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    } else {
      if (nextCode >= 1 << codeSize) {
        codeSize += 1;
      }
      table.set(key, nextCode);
      nextCode += 1;
    }
    prefix = next;
  }
  emit(prefix);
  emit(endCode);
  if (pendingBits > 0) {
    output.push(pending & 0xff);
  }
  return output.toBuffer();
}

function subBlocks(data: Buffer): Buffer {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += 255) {
    const block = data.subarray(offset, offset + 255);
    parts.push(Buffer.from([block.length]), block);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

/**
 * Streaming GIF89a encoder. Every frame gets its own palette, so the output
 * only depends on the pixels of that frame and nothing is kept between frames.
 */
export class GifEncoder {
  private started = false;

  constructor(
    private readonly settings: GifSettings,
    private readonly write: (data: Buffer) => Promise<void>
  ) {}

  /** `delay` is in hundredths of a second. */
  async addFrame(rgba: Uint8Array | Uint8ClampedArray, delay: number): Promise<void> {
    const { width, height, loop, maxColors, transparent } = this.settings;
    if (!this.started) {
      this.started = true;
      await this.write(this.header(loop));
    }
    const image = quantize(rgba, maxColors, transparent);
    const control = Buffer.alloc(8);
    control.set([0x21, 0xf9, 0x04, (transparent ? DISPOSE_TO_BACKGROUND : DISPOSE_NONE) << 2 | (transparent ? 1 : 0)]);
    control.writeUInt16LE(delay, 4);
    control[6] = image.transparentIndex ?? 0;
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(width, 5);
    descriptor.writeUInt16LE(height, 7);
    descriptor[9] = 0x80 | (image.bits - 1);
    const minCodeSize = Math.max(2, image.bits);
    await this.write(
      Buffer.concat([control, descriptor, image.palette, Buffer.from([minCodeSize]), subBlocks(lzwEncode(image.indices, minCodeSize))])
    );
  }

  async finish(): Promise<void> {
    await this.write(Buffer.from([0x3b]));
  }

  private header(loop: boolean): Buffer {
    const screen = Buffer.alloc(13);
    screen.write('GIF89a', 0, 'ascii');
    screen.writeUInt16LE(this.settings.width, 6);
    screen.writeUInt16LE(this.settings.height, 8);
    // No global palette; 8 bits of color resolution.
    screen[10] = 0x70;
    const parts = [screen];
    if (loop) {
      parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 0x03, 0x01, 0x00, 0x00, 0x00]));
    }
    return Buffer.concat(parts);
  }
}
