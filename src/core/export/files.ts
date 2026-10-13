import type { FileHandle } from 'node:fs/promises';

/** `FileHandle.write` may write less than requested; this keeps going until everything is on disk. */
export async function writeFully(handle: FileHandle, data: Uint8Array): Promise<void> {
  let written = 0;
  while (written < data.length) {
    written += (await handle.write(data, written, data.length - written)).bytesWritten;
  }
}
