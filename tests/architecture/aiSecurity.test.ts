import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc/channels';

const { exposeInMainWorld, invoke, on, removeListener } = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke, on, removeListener } }));

const SRC = path.resolve(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const code = (file: string): string => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const relative = (file: string): string => path.relative(SRC, file);
const importsOf = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');

describe('AI security boundaries', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ ok: true, value: undefined });
  });

  it('gives the renderer no way to read a credential', async () => {
    vi.resetModules();
    await import('../../src/preload/preload');
    const [, api] = exposeInMainWorld.mock.calls.at(-1) as [string, { ai: Record<string, unknown> }];
    const names = Object.keys(api.ai);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((name) => /secret|credential|password|apikey|token|keychain/i.test(name))).toEqual([]);
    expect(names.filter((name) => /^(get|read|reveal|export)/i.test(name) && !['getState', 'getCopilotStatus'].includes(name))).toEqual([]);
  });

  it('exposes only fixed, explicit AI channels, none of them generic', () => {
    const channels = Object.values(IPC_CHANNELS).filter((channel) => channel.startsWith('ai:'));
    expect(channels.length).toBeGreaterThan(20);
    expect(channels.filter((channel) => /exec|shell|eval|fs:|file-read|spawn|command/i.test(channel))).toEqual([]);
  });

  it('keeps provider traffic, secrets and processes out of the renderer', () => {
    for (const file of sourceFiles(path.join(SRC, 'renderer'))) {
      const text = code(file);
      expect(text, relative(file)).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
      expect(text, relative(file)).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(text, relative(file)).not.toMatch(/api\.openai\.com|api\.anthropic\.com/);
    }
  });

  it('uses the operating-system keychain in exactly one place', () => {
    const users = sourceFiles(SRC).filter((file) => /\bsafeStorage\b/.test(code(file)));
    expect(users.map(relative)).toEqual([path.join('main', 'services', 'safeStorageCipher.ts')]);
  });

  it('only talks to providers from the provider adapters', () => {
    const outside = sourceFiles(SRC).filter(
      (file) => !relative(file).startsWith(path.join('core', 'ai', 'providers')) && relative(file) !== path.join('main', 'main.ts') && /\bfetch\(|\bfetchImpl\(|api\.openai\.com|api\.anthropic\.com/.test(code(file))
    );
    expect(outside.map(relative)).toEqual([]);
  });

  it('never runs model-generated code', () => {
    for (const file of sourceFiles(SRC)) {
      expect(code(file), relative(file)).not.toMatch(/\beval\(|new Function\(|\bvm\.(run|Script)/);
    }
  });

  it('starts processes only for the video encoder; MCP servers are launched by the SDK from a validated command', () => {
    const users = sourceFiles(SRC).filter((file) => /child_process|\bexecSync\b|\bspawn\(/.test(code(file)));
    expect(users.map(relative)).toEqual([path.join('core', 'export', 'mp4Format.ts')]);
  });

  it('keeps AI data away from the project files, and the project away from the AI', () => {
    for (const dir of ['project', 'application']) {
      for (const file of sourceFiles(path.join(SRC, 'core', dir))) {
        expect(importsOf(file).filter((specifier) => /\/ai\/|@core\/ai/.test(specifier)), relative(file)).toEqual([]);
      }
    }
    for (const file of sourceFiles(path.join(SRC, 'core', 'ai'))) {
      expect(importsOf(file).filter((specifier) => /project|application/.test(specifier) && !/mcp/.test(specifier)), relative(file)).toEqual([]);
    }
  });

  it('keeps the agent domain free of the DOM, the renderer and any process', () => {
    for (const file of sourceFiles(path.join(SRC, 'shared', 'ai'))) {
      const text = code(file);
      expect(text, relative(file)).not.toMatch(/\bdocument\.|\bwindow\.|\bprocess\.|\brequire\(|localStorage/);
      expect(importsOf(file).filter((specifier) => /^react|electron|renderer|preload|\/main\/|\/core\/|@core|@editor/.test(specifier)), relative(file)).toEqual([]);
    }
  });
});
