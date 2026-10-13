import { crc32, inflateSync } from 'node:zlib';

/** Minimal readers for the formats the export writes, so tests can check real output bytes. */

export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export function decodePng(file: Uint8Array): DecodedImage {
  const buffer = Buffer.from(file);
  if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('Not a PNG file');
  }
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== buffer.readUInt32BE(offset + 8 + length)) {
      throw new Error(`Bad CRC in ${type}`);
    }
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6) {
        throw new Error('Expected 8-bit RGBA');
      }
    } else if (type === 'IDAT') {
      data.push(body);
    }
    offset += 12 + length;
  }
  const scanlines = inflateSync(Buffer.concat(data));
  const rowBytes = width * 4;
  const rgba = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    if (scanlines[y * (rowBytes + 1)] !== 0) {
      throw new Error('Unexpected PNG filter');
    }
    rgba.set(scanlines.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1)), y * rowBytes);
  }
  return { width, height, rgba };
}

export function pixelAt(image: DecodedImage, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return Array.from(image.rgba.subarray(offset, offset + 4));
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Reads a ZIP through its central directory, verifying every CRC. */
export function readZip(file: Uint8Array): ZipEntry[] {
  const buffer = Buffer.from(file);
  const end = buffer.length - 22;
  if (buffer.readUInt32LE(end) !== 0x06054b50) {
    throw new Error('Missing end of central directory');
  }
  const count = buffer.readUInt16LE(end + 10);
  const entries: ZipEntry[] = [];
  let offset = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Bad central directory entry');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + size);
    if (method !== 0 || crc32(data) !== crc) {
      throw new Error(`Corrupt entry ${name}`);
    }
    entries.push({ name, data });
    offset += 46 + nameLength;
  }
  return entries;
}

export interface GifFrame extends DecodedImage {
  /** Hundredths of a second. */
  delay: number;
}

export interface DecodedGif {
  width: number;
  height: number;
  /** Repeat count from the NETSCAPE extension (0 = forever), `null` when the extension is missing. */
  loopCount: number | null;
  frames: GifFrame[];
}

function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): number[] {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let dictionary: number[][] = [];
  let codeSize = minCodeSize + 1;
  const reset = (): void => {
    dictionary = Array.from({ length: clearCode }, (_, index) => [index]);
    dictionary.push([], []);
    codeSize = minCodeSize + 1;
  };
  reset();
  const output: number[] = [];
  let previous: number[] | null = null;
  let bits = 0;
  let bitCount = 0;
  let position = 0;
  while (output.length < pixelCount) {
    while (bitCount < codeSize) {
      if (position >= data.length) {
        throw new Error('LZW data ended early');
      }
      bits |= (data[position] as number) << bitCount;
      position += 1;
      bitCount += 8;
    }
    const code = bits & ((1 << codeSize) - 1);
    bits >>>= codeSize;
    bitCount -= codeSize;
    if (code === clearCode) {
      reset();
      previous = null;
      continue;
    }
    if (code === endCode) {
      break;
    }
    const entry: number[] | undefined = dictionary[code] ?? (previous === null ? undefined : [...previous, previous[0] as number]);
    if (entry === undefined) {
      throw new Error('Invalid LZW code');
    }
    output.push(...entry);
    if (previous !== null && dictionary.length < 4096) {
      dictionary.push([...previous, entry[0] as number]);
    }
    previous = entry;
    if (dictionary.length === 1 << codeSize && codeSize < 12) {
      codeSize += 1;
    }
  }
  return output;
}

/** Decodes the GIF files this application writes (local palettes, full-canvas frames). */
export function decodeGif(file: Uint8Array): DecodedGif {
  const buffer = Buffer.from(file);
  if (buffer.toString('ascii', 0, 6) !== 'GIF89a') {
    throw new Error('Not a GIF89a file');
  }
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  if ((buffer[10] as number) & 0x80) {
    throw new Error('Unexpected global palette');
  }
  const gif: DecodedGif = { width, height, loopCount: null, frames: [] };
  let delay = 0;
  let transparentIndex: number | null = null;
  const readBlocks = (start: number): { data: Buffer; next: number } => {
    const parts: Buffer[] = [];
    let offset = start;
    while (buffer[offset] !== 0) {
      const length = buffer[offset] as number;
      parts.push(buffer.subarray(offset + 1, offset + 1 + length));
      offset += 1 + length;
    }
    return { data: Buffer.concat(parts), next: offset + 1 };
  };

  let offset = 13;
  for (;;) {
    const marker = buffer[offset];
    if (marker === 0x3b) {
      return gif;
    }
    if (marker === 0x21) {
      const label = buffer[offset + 1];
      if (label === 0xf9) {
        delay = buffer.readUInt16LE(offset + 4);
        transparentIndex = (buffer[offset + 3] as number) & 1 ? (buffer[offset + 6] as number) : null;
        offset += 8;
      } else {
        const { data, next } = readBlocks(offset + 3 + (buffer[offset + 2] as number));
        if (buffer.toString('ascii', offset + 3, offset + 14) === 'NETSCAPE2.0') {
          gif.loopCount = data.readUInt16LE(1);
        }
        offset = next;
      }
      continue;
    }
    if (marker !== 0x2c) {
      throw new Error(`Unexpected block 0x${(marker ?? 0).toString(16)}`);
    }
    const frameWidth = buffer.readUInt16LE(offset + 5);
    const frameHeight = buffer.readUInt16LE(offset + 7);
    const colors = 2 ** (((buffer[offset + 9] as number) & 7) + 1);
    const palette = buffer.subarray(offset + 10, offset + 10 + colors * 3);
    const minCodeSize = buffer[offset + 10 + colors * 3] as number;
    const { data, next } = readBlocks(offset + 11 + colors * 3);
    const indices = lzwDecode(data, minCodeSize, frameWidth * frameHeight);
    const rgba = new Uint8Array(frameWidth * frameHeight * 4);
    indices.forEach((index, pixel) => {
      if (index === transparentIndex) {
        return;
      }
      rgba.set([palette[index * 3] as number, palette[index * 3 + 1] as number, palette[index * 3 + 2] as number, 255], pixel * 4);
    });
    gif.frames.push({ width: frameWidth, height: frameHeight, rgba, delay });
    offset = next;
  }
}
