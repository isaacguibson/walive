import { open, type FileHandle } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import type { EntryWriter } from './entryWriter';
import { writeFully } from './files';
import { AppError } from '../errors';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const VERSION = 20;
/** File names are UTF-8. */
const UTF8_FLAG = 0x0800;
const STORED = 0;
const MAX_32_BIT = 0xffff_ffff;
const MAX_ENTRIES = 0xffff;

interface CentralRecord {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
}

function dosDateTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

/**
 * Streams a ZIP archive to disk, one entry at a time. Entries are stored
 * without compression: PNG data is already compressed. Archives that would
 * need ZIP64 are rejected instead of being written incorrectly.
 */
export class ZipWriter implements EntryWriter {
  private offset = 0;
  private readonly records: CentralRecord[] = [];
  private readonly stamp = dosDateTime(new Date());

  private constructor(private readonly handle: FileHandle) {}

  static async create(filePath: string): Promise<ZipWriter> {
    return new ZipWriter(await open(filePath, 'w'));
  }

  async add(name: string, data: Uint8Array): Promise<void> {
    const fileName = Buffer.from(name, 'utf8');
    const entrySize = 30 + fileName.length + data.length;
    if (this.records.length >= MAX_ENTRIES || this.offset + entrySize > MAX_32_BIT) {
      throw new AppError('EXPORT_FAILED', 'The archive is too large for the ZIP format. Export fewer frames or use a smaller resolution.');
    }
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(UTF8_FLAG, 6);
    header.writeUInt16LE(STORED, 8);
    header.writeUInt16LE(this.stamp.time, 10);
    header.writeUInt16LE(this.stamp.day, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(fileName.length, 26);
    this.records.push({ name: fileName, crc, size: data.length, offset: this.offset });
    await this.write(Buffer.concat([header, fileName]));
    await this.write(data);
  }

  async finish(): Promise<void> {
    const directoryOffset = this.offset;
    for (const record of this.records) {
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(CENTRAL_HEADER, 0);
      entry.writeUInt16LE(VERSION, 4);
      entry.writeUInt16LE(VERSION, 6);
      entry.writeUInt16LE(UTF8_FLAG, 8);
      entry.writeUInt16LE(STORED, 10);
      entry.writeUInt16LE(this.stamp.time, 12);
      entry.writeUInt16LE(this.stamp.day, 14);
      entry.writeUInt32LE(record.crc, 16);
      entry.writeUInt32LE(record.size, 20);
      entry.writeUInt32LE(record.size, 24);
      entry.writeUInt16LE(record.name.length, 28);
      entry.writeUInt32LE(record.offset, 42);
      await this.write(Buffer.concat([entry, record.name]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_DIRECTORY, 0);
    end.writeUInt16LE(this.records.length, 8);
    end.writeUInt16LE(this.records.length, 10);
    end.writeUInt32LE(this.offset - directoryOffset, 12);
    end.writeUInt32LE(directoryOffset, 16);
    await this.write(end);
    await this.handle.close();
  }

  async abort(): Promise<void> {
    await this.handle.close().catch(() => undefined);
  }

  private async write(data: Uint8Array): Promise<void> {
    await writeFully(this.handle, data);
    this.offset += data.length;
  }
}
