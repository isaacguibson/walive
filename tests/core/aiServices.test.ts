import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '@core/errors';
import { readAttachments } from '@core/ai/attachments';
import { SecureCredentialService } from '@core/ai/secureCredentialService';
import type { Logger } from '@core/logger';
import { DEFAULT_APPROVAL, DEFAULT_LIMITS, type Conversation, type SaveProviderInput, type TurnRequest } from '@shared/ai/types';
import { createAiServices, FakeCipher } from '../helpers/ai';
import { fakeFetch, hanging, json, sse } from '../helpers/http';
import { makeTempDir } from '../helpers/tempDir';

const KEY = 'sk-live-SUPER-SECRET-1234';

const provider = (overrides: Partial<SaveProviderInput> = {}): SaveProviderInput => ({ id: null, kind: 'openai', name: 'Work', baseUrl: null, apiKey: KEY, manualModels: [], ...overrides });
const code = async (promise: Promise<unknown>): Promise<string | undefined> => promise.then(() => undefined, (error: unknown) => (error instanceof AppError ? error.code : 'NOT_AN_APP_ERROR'));

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)])));
  return nested.flat();
}

async function everyFileContaining(directory: string, text: string): Promise<string[]> {
  const matches: string[] = [];
  for (const file of await filesUnder(directory)) {
    if ((await readFile(file, 'latin1')).includes(text)) {
      matches.push(path.relative(directory, file));
    }
  }
  return matches;
}

describe('secure credential storage', () => {
  it('stores secrets encrypted, returns them on request and removes them', async () => {
    const root = await makeTempDir();
    const file = path.join(root, 'credentials.json');
    const credentials = new SecureCredentialService(file, new FakeCipher());
    await credentials.set('provider:1', KEY);
    expect(await credentials.get('provider:1')).toBe(KEY);
    expect(await credentials.get('provider:other')).toBeNull();
    expect(await readFile(file, 'utf8')).not.toContain(KEY);
    await credentials.delete('provider:1');
    expect(await credentials.get('provider:1')).toBeNull();
    expect(await readFile(file, 'utf8')).not.toContain('provider:1');
  });

  it('refuses to store anything when the system cannot encrypt, and writes nothing', async () => {
    const root = await makeTempDir();
    const cipher = new FakeCipher();
    cipher.available = false;
    const file = path.join(root, 'credentials.json');
    const credentials = new SecureCredentialService(file, cipher);
    expect(await code(credentials.set('provider:1', KEY))).toBe('AI_STORAGE_UNAVAILABLE');
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  it('reports a secret that can no longer be decrypted instead of returning garbage', async () => {
    const root = await makeTempDir();
    const file = path.join(root, 'credentials.json');
    await writeFile(file, JSON.stringify({ version: 1, secrets: { a: 'enc:%%%' } }));
    const credentials = new SecureCredentialService(file, { isAvailable: () => true, encrypt: (text) => text, decrypt: () => { throw new Error('bad'); } });
    expect(await code(credentials.get('a'))).toBe('AI_STORAGE_UNAVAILABLE');
  });

  it('keeps every secret when several are saved at once', async () => {
    const root = await makeTempDir();
    const credentials = new SecureCredentialService(path.join(root, 'credentials.json'), new FakeCipher());
    await Promise.all(Array.from({ length: 10 }, (_, index) => credentials.set(`k${index}`, `value-${index}`)));
    expect(await Promise.all(Array.from({ length: 10 }, (_, index) => credentials.get(`k${index}`)))).toEqual(Array.from({ length: 10 }, (_, index) => `value-${index}`));
  });
});

describe('provider settings', () => {
  it('saves a provider without ever writing its key to the settings, and masks it', async () => {
    const root = await makeTempDir();
    const { settings, directory } = createAiServices(root);
    const saved = await settings.saveProvider(provider());
    expect(saved).toMatchObject({ kind: 'openai', name: 'Work', baseUrl: null, credentialHint: '••••1234' });
    expect(await readFile(path.join(directory, 'settings.json'), 'utf8')).not.toContain(KEY);
    expect(await everyFileContaining(root, KEY)).toEqual([]);
    expect((await settings.connection(saved.id)).connection.apiKey).toBe(KEY);
  });

  it('keeps the stored key when it is edited without a new one, and replaces it with a new one', async () => {
    const { settings } = createAiServices(await makeTempDir());
    const saved = await settings.saveProvider(provider());
    const renamed = await settings.saveProvider(provider({ id: saved.id, name: 'Renamed', apiKey: null }));
    expect(renamed).toMatchObject({ id: saved.id, name: 'Renamed', credentialHint: '••••1234' });
    expect((await settings.connection(saved.id)).connection.apiKey).toBe(KEY);
    const replaced = await settings.saveProvider(provider({ id: saved.id, apiKey: 'sk-new-key-5678' }));
    expect(replaced.credentialHint).toBe('••••5678');
    expect((await settings.connection(saved.id)).connection.apiKey).toBe('sk-new-key-5678');
  });

  it('disconnects a provider by forgetting its key but keeping the connection', async () => {
    const { settings } = createAiServices(await makeTempDir());
    const saved = await settings.saveProvider(provider());
    await settings.disconnectProvider(saved.id);
    expect((await settings.get()).providers[0]).toMatchObject({ id: saved.id, credentialHint: null });
    expect((await settings.connection(saved.id)).connection.apiKey).toBeNull();
  });

  it('removes a provider together with its key, its model preferences and its selection', async () => {
    const root = await makeTempDir();
    const { settings } = createAiServices(root);
    const saved = await settings.saveProvider(provider());
    await settings.updatePreferences({ selection: { providerId: saved.id, modelId: 'gpt-4o' }, efforts: { [`${saved.id}/o3`]: 'high' } });
    await settings.removeProvider(saved.id);
    expect(await settings.get()).toMatchObject({ providers: [], selection: null, efforts: {} });
    expect(await code(settings.connection(saved.id))).toBe('AI_NOT_FOUND');
    expect(await everyFileContaining(root, 'enc:')).toEqual([]);
  });

  it('refuses providers that are unavailable or badly configured', async () => {
    const { settings } = createAiServices(await makeTempDir());
    expect(await code(settings.saveProvider(provider({ kind: 'copilot' })))).toBe('AI_UNSUPPORTED');
    expect(await code(settings.saveProvider(provider({ name: '  ' })))).toBe('AI_INVALID_CONFIG');
    expect(await code(settings.saveProvider(provider({ kind: 'openai-compatible', baseUrl: null })))).toBe('AI_INVALID_CONFIG');
    expect(await code(settings.saveProvider(provider({ baseUrl: 'http://remote.example.com/v1' })))).toBe('AI_INVALID_CONFIG');
    expect(await code(settings.saveProvider(provider({ id: 'unknown' })))).toBe('AI_NOT_FOUND');
    expect(await code(settings.saveProvider(provider({ manualModels: [{ id: 'a b', displayName: '', image: false, tools: false, efforts: [] }] })))).toBe('AI_INVALID_CONFIG');
    const twice = { id: 'm', displayName: '', image: false, tools: false, efforts: [] };
    expect(await code(settings.saveProvider(provider({ manualModels: [twice, twice] })))).toBe('AI_INVALID_CONFIG');
    expect((await settings.get()).providers).toEqual([]);
  });

  it('does not save a key when secure storage is unavailable', async () => {
    const cipher = new FakeCipher();
    cipher.available = false;
    const { settings } = createAiServices(await makeTempDir(), { cipher });
    expect(await code(settings.saveProvider(provider()))).toBe('AI_STORAGE_UNAVAILABLE');
    expect((await settings.get()).providers).toEqual([]);
  });

  it('normalizes a custom endpoint and keeps declared models with exactly what the user stated', async () => {
    const { settings } = createAiServices(await makeTempDir());
    const saved = await settings.saveProvider(
      provider({ kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1/', apiKey: null, manualModels: [{ id: 'llama', displayName: '', image: true, tools: false, efforts: ['low'] }] })
    );
    expect(saved).toMatchObject({ baseUrl: 'http://localhost:11434/v1', credentialHint: null, manualModels: [{ id: 'llama', displayName: 'llama', image: true, tools: false, efforts: ['low'] }] });
  });

  it('validates preferences, limits and the approval policy', async () => {
    const { settings } = createAiServices(await makeTempDir());
    expect(await settings.get()).toMatchObject({ limits: DEFAULT_LIMITS, approval: DEFAULT_APPROVAL, selection: null });
    expect(await code(settings.updatePreferences({ selection: { providerId: 'missing', modelId: 'm' } }))).toBe('AI_INVALID_CONFIG');
    expect(await code(settings.updatePreferences({ limits: { ...DEFAULT_LIMITS, maxIterations: 0 } }))).toBe('AI_INVALID_CONFIG');
    expect(await code(settings.updatePreferences({ limits: { ...DEFAULT_LIMITS, maxToolCalls: 1.5 } }))).toBe('AI_INVALID_CONFIG');
    expect(await code(settings.updatePreferences({ approval: { modify: 'never' as 'ask', external: 'ask' } }))).toBe('AI_INVALID_CONFIG');
    const updated = await settings.updatePreferences({ limits: { ...DEFAULT_LIMITS, maxIterations: 5 }, approval: { modify: 'ask', external: 'ask' } });
    expect(updated).toMatchObject({ limits: { maxIterations: 5 }, approval: { modify: 'ask' } });
  });

  it('recovers from a damaged settings file with the defaults', async () => {
    const root = await makeTempDir();
    const { settings, directory } = createAiServices(root);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'settings.json'), '{not json');
    expect(await settings.get()).toMatchObject({ providers: [], limits: DEFAULT_LIMITS });
  });
});

describe('connection validation and model discovery', () => {
  it('validates a configuration without saving it and counts the available models', async () => {
    const { fetch, requests } = fakeFetch(json({ data: [{ id: 'gpt-4o' }, { id: 'o3' }] }), json({ data: [{ id: 'gpt-4o' }, { id: 'o3' }] }));
    const { connections, settings } = createAiServices(await makeTempDir(), { fetch });
    const result = await connections.validate(provider({ manualModels: [{ id: 'extra', displayName: 'extra', image: false, tools: true, efforts: [] }] }));
    expect(result).toEqual({ modelCount: 3 });
    expect(requests[0]?.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
    expect((await settings.get()).providers).toEqual([]);
  });

  it('explains a missing or rejected key without repeating it', async () => {
    const { fetch } = fakeFetch(json({ error: { message: `bad key ${KEY}` } }, 401));
    const { connections } = createAiServices(await makeTempDir(), { fetch });
    expect(await code(connections.validate(provider({ apiKey: null })))).toBe('AI_NOT_CONFIGURED');
    const error = await connections.validate(provider()).catch((caught: unknown) => caught);
    expect((error as AppError).code).toBe('AI_AUTH_FAILED');
    expect((error as AppError).message).not.toContain(KEY);
  });

  it('uses the stored key when a saved provider is tested again without typing it', async () => {
    const { fetch, requests } = fakeFetch(json({ data: [] }), json({ data: [] }), json({ data: [] }));
    const { connections, settings } = createAiServices(await makeTempDir(), { fetch });
    const saved = await settings.saveProvider(provider());
    await connections.validate(provider({ id: saved.id, apiKey: null }));
    expect(requests[0]?.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
  });

  it('merges discovered models with declared ones; declared models win and say where they come from', async () => {
    const { fetch } = fakeFetch(json({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4.1' }] }), json({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4.1' }] }));
    const { connections, settings } = createAiServices(await makeTempDir(), { fetch });
    const saved = await settings.saveProvider(provider({ manualModels: [{ id: 'gpt-4o', displayName: 'My GPT', image: false, tools: true, efforts: ['low'] }] }));
    const models = await connections.refreshModels(saved.id);
    expect(models.map((model) => model.id).sort()).toEqual(['gpt-4.1', 'gpt-4o']);
    expect(models.find((model) => model.id === 'gpt-4o')).toMatchObject({ source: 'manual', displayName: 'My GPT', capabilities: { image: 'no', tools: 'yes', efforts: ['low'] } });
    expect(models.find((model) => model.id === 'gpt-4.1')).toMatchObject({ source: 'catalog' });
    expect((await connections.listModels()).map((model) => model.id).sort()).toEqual(['gpt-4.1', 'gpt-4o']);
  });

  it('works with declared models when the provider cannot list any', async () => {
    const { fetch } = fakeFetch(json({}, 404), json({}, 404));
    const { connections, settings } = createAiServices(await makeTempDir(), { fetch });
    const saved = await settings.saveProvider(
      provider({ kind: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', apiKey: null, manualModels: [{ id: 'local', displayName: 'local', image: false, tools: false, efforts: [] }] })
    );
    expect((await connections.refreshModels(saved.id)).map((model) => model.id)).toEqual(['local']);
  });

  it('marks the models of a provider without a key as unavailable and keeps the old list when a refresh fails', async () => {
    const { fetch } = fakeFetch(json({ data: [{ id: 'gpt-4o' }] }), json({ error: { message: 'down' } }, 500));
    const { connections, settings } = createAiServices(await makeTempDir(), { fetch });
    const saved = await settings.saveProvider(provider());
    await connections.refreshModels(saved.id);
    expect(await code(connections.refreshModels(saved.id))).toBe('AI_PROVIDER_ERROR');
    expect((await connections.listModels()).map((model) => model.id)).toEqual(['gpt-4o']);
    await settings.disconnectProvider(saved.id);
    expect((await connections.listModels())[0]?.available).toBe(false);
  });
});

describe('model requests', () => {
  const request = (providerId: string, overrides: Partial<TurnRequest> = {}): TurnRequest => ({
    requestId: 'r1',
    providerId,
    modelId: 'gpt-4o',
    effort: null,
    system: 'system',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    tools: [],
    ...overrides
  });
  const stream = () => sse([{ choices: [{ delta: { content: 'Hello' }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]']);

  it('runs a turn with the stored key and publishes the streamed text', async () => {
    const { fetch, requests } = fakeFetch(stream());
    const { turns, settings, events } = createAiServices(await makeTempDir(), { fetch });
    const saved = await settings.saveProvider(provider());
    const result = await turns.run(request(saved.id));
    expect(result).toEqual({ text: 'Hello', toolCalls: [], stopReason: 'end' });
    expect(events).toEqual([{ requestId: 'r1', delta: 'Hello' }]);
    expect(requests[0]?.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
  });

  it('asks for a key instead of calling a provider that has none', async () => {
    const { fetch, requests } = fakeFetch();
    const { turns, settings } = createAiServices(await makeTempDir(), { fetch });
    const saved = await settings.saveProvider(provider({ apiKey: null }));
    expect(await code(turns.run(request(saved.id)))).toBe('AI_NOT_CONFIGURED');
    expect(await code(turns.run(request('missing')))).toBe('AI_NOT_FOUND');
    expect(requests).toHaveLength(0);
  });

  it('cancels a running request', async () => {
    const { fetch } = fakeFetch(hanging());
    const { turns, settings } = createAiServices(await makeTempDir(), { fetch });
    const saved = await settings.saveProvider(provider());
    const pending = turns.run(request(saved.id));
    await new Promise((resolve) => setTimeout(resolve, 10));
    turns.cancel('r1');
    expect(await code(pending)).toBe('AI_CANCELLED');
    // The id is free again afterwards.
    turns.cancel('r1');
  });

  it('does not run two requests with the same id', async () => {
    const { fetch } = fakeFetch(hanging());
    const { turns, settings } = createAiServices(await makeTempDir(), { fetch });
    const saved = await settings.saveProvider(provider());
    const first = turns.run(request(saved.id));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await code(turns.run(request(saved.id)))).toBe('INVALID_REQUEST');
    turns.cancel('r1');
    await code(first);
  });
});

describe('conversation storage', () => {
  const conversation = (id: string, overrides: Partial<Conversation> = {}): Conversation => ({
    id,
    title: 'First chat',
    createdAt: '2026-10-13T10:00:00.000Z',
    updatedAt: '2026-10-13T10:00:00.000Z',
    providerId: 'p',
    modelId: 'm',
    entries: [{ id: 'e1', at: '2026-10-13T10:00:00.000Z', kind: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Draw a cat' }, { type: 'image', mediaType: 'image/png', data: 'SECRETPIXELS' }] }, attachments: [{ name: 'cat.png', kind: 'image', size: 12 }] }],
    ...overrides
  });

  it('saves, lists, loads, renames and deletes conversations', async () => {
    const { conversations } = createAiServices(await makeTempDir());
    expect(await conversations.list()).toEqual([]);
    await conversations.save(conversation('conversation-a'));
    await conversations.save(conversation('conversation-b', { title: 'Second', updatedAt: '2026-10-13T11:00:00.000Z' }));
    expect((await conversations.list()).map((summary) => [summary.id, summary.title, summary.entryCount])).toEqual([
      ['conversation-b', 'Second', 1],
      ['conversation-a', 'First chat', 1]
    ]);
    expect((await conversations.load('conversation-a'))?.entries).toHaveLength(1);
    await conversations.rename('conversation-a', '  Renamed  ');
    expect((await conversations.load('conversation-a'))?.title).toBe('Renamed');
    expect(await code(conversations.rename('conversation-a', ' '))).toBe('INVALID_REQUEST');
    expect(await code(conversations.rename('conversation-zzz', 'x'))).toBe('AI_NOT_FOUND');
    await conversations.delete('conversation-a');
    expect(await conversations.load('conversation-a')).toBeNull();
  });

  it('does not store the contents of attached images', async () => {
    const root = await makeTempDir();
    const { conversations } = createAiServices(root);
    await conversations.save(conversation('conversation-a'));
    expect(await everyFileContaining(root, 'SECRETPIXELS')).toEqual([]);
    const loaded = await conversations.load('conversation-a');
    expect(JSON.stringify(loaded)).toContain('not stored');
    expect(JSON.stringify(loaded)).toContain('cat.png');
  });

  it('refuses ids that could escape the conversation folder', async () => {
    const { conversations } = createAiServices(await makeTempDir());
    for (const id of ['../settings', 'a/b', '..', 'x']) {
      expect(await code(conversations.load(id))).toBe('INVALID_REQUEST');
      expect(await code(conversations.delete(id))).toBe('INVALID_REQUEST');
    }
  });

  it('skips a damaged conversation and clears everything on request', async () => {
    const root = await makeTempDir();
    const { conversations, directory } = createAiServices(root);
    await conversations.save(conversation('conversation-a'));
    await writeFile(path.join(directory, 'conversations', 'conversation-b.json'), '{broken');
    expect((await conversations.list()).map((summary) => summary.id)).toEqual(['conversation-a']);
    expect(await conversations.clear()).toBe(1);
    expect(await conversations.list()).toEqual([]);
  });
});

describe('attachments', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  async function files(contents: Record<string, Buffer | string>): Promise<{ root: string; paths: Record<string, string> }> {
    const root = await makeTempDir();
    const paths: Record<string, string> = {};
    for (const [name, content] of Object.entries(contents)) {
      paths[name] = path.join(root, name);
      await writeFile(paths[name] as string, content);
    }
    return { root, paths };
  }

  it('reads images and text files', async () => {
    const { paths } = await files({ 'a.png': PNG, 'b.md': '# Notes', 'c.json': '{"a":1}', 'd.jpg': Buffer.from([0xff, 0xd8, 0xff]) });
    const result = await readAttachments(Object.values(paths), 1_000_000);
    expect(result.rejected).toEqual([]);
    expect(result.attachments.map((attachment) => [attachment.name, attachment.kind, attachment.mediaType])).toEqual([
      ['a.png', 'image', 'image/png'],
      ['b.md', 'text', 'text/plain'],
      ['c.json', 'text', 'text/plain'],
      ['d.jpg', 'image', 'image/jpeg']
    ]);
    expect(result.attachments[0]?.data).toBe(PNG.toString('base64'));
    expect(result.attachments[1]?.data).toBe('# Notes');
    expect(new Set(result.attachments.map((attachment) => attachment.id)).size).toBe(4);
  });

  it('rejects, with a reason, what it cannot safely send', async () => {
    const { paths, root } = await files({ 'fake.png': 'not an image', 'doc.pdf': '%PDF', 'tool.exe': 'MZ', 'bin.txt': Buffer.from([65, 0, 66]), 'big.txt': 'x'.repeat(2_000) });
    const result = await readAttachments([...Object.values(paths), path.join(root, 'missing.txt')], 1_000);
    expect(Object.fromEntries(result.rejected.map((item) => [item.name, item.reason]))).toEqual({
      'fake.png': 'The content does not match the file extension.',
      'doc.pdf': expect.stringContaining('PDF text extraction is not available'),
      'tool.exe': 'This file type is not supported.',
      'bin.txt': 'The file is not plain text.',
      'big.txt': expect.stringContaining('larger than the limit'),
      'missing.txt': 'The file does not exist or is not a regular file.'
    });
    expect(result.attachments).toEqual([]);
  });

  it('limits how many files one message can carry', async () => {
    const contents = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`f${index}.txt`, 'x']));
    const { paths } = await files(contents);
    const result = await readAttachments(Object.values(paths), 1_000);
    expect(result.attachments).toHaveLength(8);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]?.reason).toContain('At most 8');
  });

  it('refuses a directory', async () => {
    const root = await makeTempDir();
    await mkdir(path.join(root, 'folder.txt'));
    expect((await readAttachments([path.join(root, 'folder.txt')], 1_000)).rejected).toHaveLength(1);
  });
});

describe('credentials never leak', () => {
  it('keeps the key out of every file, every log and every error across a whole session', async () => {
    const root = await makeTempDir();
    const logs: string[] = [];
    const logger: Logger = {
      info: (message, details) => void logs.push(JSON.stringify([message, details])),
      warn: (message, details) => void logs.push(JSON.stringify([message, details])),
      error: (message, details) => void logs.push(JSON.stringify([message, details]))
    };
    const echoing = fakeFetch(
      json({ data: [{ id: 'gpt-4o' }] }),
      sse([{ choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }]),
      json({ error: { message: `Invalid key ${KEY}` } }, 401),
      new TypeError(`connect failed with ${KEY}`)
    );
    const { settings, connections, turns, conversations } = createAiServices(root, { fetch: echoing.fetch, logger });
    const saved = await settings.saveProvider(provider());
    await connections.refreshModels(saved.id);
    const request: TurnRequest = { requestId: 'r', providerId: saved.id, modelId: 'gpt-4o', effort: null, system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }], tools: [] };
    await turns.run(request);
    const failures = [await turns.run({ ...request, requestId: 'r2' }).catch((error: unknown) => error), await turns.run({ ...request, requestId: 'r3' }).catch((error: unknown) => error)];
    await conversations.save({ id: 'conversation-a', title: 'Chat', createdAt: 'x', updatedAt: 'x', providerId: saved.id, modelId: 'gpt-4o', entries: [{ id: 'e', at: 'x', kind: 'notice', level: 'error', text: (failures[0] as Error).message, retryable: false }] });

    expect(await everyFileContaining(root, KEY)).toEqual([]);
    expect(logs.join('\n')).not.toContain(KEY);
    for (const failure of failures) {
      expect((failure as Error).message).not.toContain(KEY);
    }
  });
});
