import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

const created: string[] = [];

/** Creates a temporary directory that is removed after each test. */
export async function makeTempDir(prefix = 'animation-studio-test-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  // realpath-free: macOS tmpdir symlinks are irrelevant since we only compare paths we built ourselves.
  created.push(dir);
  return dir;
}

afterEach(async () => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
