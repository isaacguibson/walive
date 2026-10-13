import { promisify } from 'node:util';
import { crc32, deflate } from 'node:zlib';

const deflateAsync = promisify(deflate);
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR_TYPE_RGBA = 6;

function chunk(type: string, data: Uint8Array): Buffer {
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  result.write(type, 4, 'ascii');
  result.set(data, 8);
  result.writeUInt32BE(crc32(result.subarray(4, 8 + data.length)), 8 + data.length);
  return result;
}

/** Encodes non-premultiplied 8-bit RGBA pixels as a PNG, keeping the alpha channel. */
export async function encodePng(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<Buffer> {
  const rowBytes = width * 4;
  const scanlines = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y += 1) {
    // Filter type 0 (none) at the start of every scanline.
    scanlines.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = COLOR_TYPE_RGBA;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', await deflateAsync(scanlines)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
