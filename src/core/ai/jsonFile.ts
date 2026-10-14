import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppError, isNodeError } from '../errors';

/** Small JSON file in the application data directory, written atomically. */
export class JsonFile<T> {
  constructor(
    private readonly filePath: string,
    private readonly parse: (value: unknown) => T,
    private readonly label: string
  ) {}

  /** Returns `parse(undefined)` when the file does not exist and keeps a copy of a damaged one. */
  async read(): Promise<T> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return this.parse(undefined);
      }
      throw new AppError('STATE_READ_FAILED', `${this.label} could not be loaded.`, { cause: error });
    }
    try {
      return this.parse(JSON.parse(text));
    } catch {
      await fs.rename(this.filePath, `${this.filePath}.corrupt`).catch(() => undefined);
      return this.parse(undefined);
    }
  }

  async write(value: T): Promise<void> {
    const temp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      // Owner-only: the files may hold encrypted credentials or private conversations.
      await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temp, this.filePath);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw new AppError('STATE_WRITE_FAILED', `${this.label} could not be saved.`, { cause: error });
    }
  }
}

/** Runs async operations one after another, so read-modify-write cycles never interleave. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
