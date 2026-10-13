import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Receives the files of a multi-file export, addressed by their path relative to the export root. */
export interface EntryWriter {
  add(relativePath: string, data: Uint8Array): Promise<void>;
  finish(): Promise<void>;
  abort(): Promise<void>;
}

/** Writes entries as plain files below `root`. */
export class DirectoryEntryWriter implements EntryWriter {
  constructor(private readonly root: string) {}

  async add(relativePath: string, data: Uint8Array): Promise<void> {
    const target = path.join(this.root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async finish(): Promise<void> {}

  async abort(): Promise<void> {}
}
