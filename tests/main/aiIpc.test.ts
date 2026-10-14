import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '@core/logger';
import { IPC_CHANNELS } from '@shared/ipc/channels';
import type { AIState, AttachmentPickResult, Conversation, McpServerStatus, TurnResult } from '@shared/ai/types';
import type { IpcResult } from '@shared/types/errors';
import { registerAiIpcHandlers } from '../../src/main/ipc/registerAiIpcHandlers';
import { createAiServices } from '../helpers/ai';
import { fakeFetch, hanging, json, sse } from '../helpers/http';
import { makeTempDir } from '../helpers/tempDir';

const KEY = 'sk-ipc-SECRET-4321';

async function setup(responses: Parameters<typeof fakeFetch>, picked: string[] = []) {
  const root = await makeTempDir();
  const http = fakeFetch(...responses);
  const services = createAiServices(root, { fetch: http.fetch });
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
  registerAiIpcHandlers({ ipc: { handle: (channel, listener) => void handlers.set(channel, listener) }, ...services, attachmentPicker: { pickFiles: async () => picked }, logger: silentLogger });
  async function invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
    const handler = handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`No handler for ${channel}`);
    }
    return (await handler({}, payload)) as IpcResult<T>;
  }
  return { root, invoke, handlers, http, ...services };
}

const providerPayload = (overrides: Record<string, unknown> = {}) => ({ id: null, kind: 'openai', name: 'Work', baseUrl: null, apiKey: KEY, manualModels: [], ...overrides });
const turnPayload = (providerId: string, overrides: Record<string, unknown> = {}) => ({
  requestId: 'r1',
  providerId,
  modelId: 'gpt-4o',
  effort: null,
  system: 'system',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
  tools: [],
  ...overrides
});

describe('AI IPC handlers', () => {
  it('registers every AI channel and nothing else', async () => {
    const { handlers } = await setup([]);
    expect([...handlers.keys()].sort()).toEqual(Object.values(IPC_CHANNELS).filter((channel) => channel.startsWith('ai:')).sort());
  });

  it('saves a provider, discovers its models and returns a state that never contains the key', async () => {
    const { invoke, http } = await setup([json({ data: [{ id: 'gpt-4o' }, { id: 'whisper-1' }] })]);
    const saved = await invoke<AIState>(IPC_CHANNELS.aiSaveProvider, providerPayload());
    expect(saved).toMatchObject({ ok: true, value: { settings: { providers: [{ name: 'Work', credentialHint: '••••4321' }] }, models: [{ id: 'gpt-4o', available: true }] } });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(http.requests[0]?.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
    const state = await invoke<AIState>(IPC_CHANNELS.aiGetState);
    expect(JSON.stringify(state)).not.toContain(KEY);
    expect(state.ok && state.value.descriptors.map((descriptor) => descriptor.kind).sort()).toEqual(['anthropic', 'copilot', 'openai', 'openai-compatible']);
  });

  it('saves a provider even when the model list cannot be fetched', async () => {
    const { invoke } = await setup([new TypeError('offline')]);
    const saved = await invoke<AIState>(IPC_CHANNELS.aiSaveProvider, providerPayload());
    expect(saved).toMatchObject({ ok: true, value: { settings: { providers: [{ name: 'Work' }] }, models: [] } });
  });

  it('tests a configuration without saving it', async () => {
    const { invoke } = await setup([json({ data: [{ id: 'gpt-4o' }] }), json({ data: [{ id: 'gpt-4o' }] })]);
    expect(await invoke(IPC_CHANNELS.aiTestProvider, providerPayload())).toEqual({ ok: true, value: { modelCount: 1 } });
    const state = await invoke<AIState>(IPC_CHANNELS.aiGetState);
    expect(state.ok && state.value.settings.providers).toEqual([]);
  });

  it('reports a rejected key as an error result instead of throwing', async () => {
    const { invoke } = await setup([json({ error: { message: 'bad' } }, 401)]);
    expect(await invoke(IPC_CHANNELS.aiTestProvider, providerPayload())).toMatchObject({ ok: false, error: { code: 'AI_AUTH_FAILED' } });
  });

  it('updates preferences, disconnects and removes providers', async () => {
    const { invoke } = await setup([json({ data: [] })]);
    const saved = await invoke<AIState>(IPC_CHANNELS.aiSaveProvider, providerPayload());
    const providerId = saved.ok ? (saved.value.settings.providers[0]?.id ?? '') : '';
    const preferences = await invoke<AIState>(IPC_CHANNELS.aiUpdatePreferences, { selection: { providerId, modelId: 'gpt-4o' }, efforts: { [`${providerId}/gpt-4o`]: 'low' } });
    expect(preferences.ok && preferences.value.settings).toMatchObject({ selection: { providerId, modelId: 'gpt-4o' }, efforts: { [`${providerId}/gpt-4o`]: 'low' } });
    const disconnected = await invoke<AIState>(IPC_CHANNELS.aiDisconnectProvider, { providerId });
    expect(disconnected.ok && disconnected.value.settings.providers[0]?.credentialHint).toBeNull();
    const removed = await invoke<AIState>(IPC_CHANNELS.aiRemoveProvider, { providerId });
    expect(removed.ok && removed.value.settings).toMatchObject({ providers: [], selection: null });
  });

  it('runs a model request and streams the text through the event publisher', async () => {
    const { invoke, events } = await setup([json({ data: [] }), sse([{ choices: [{ delta: { content: 'Hi there' }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]'])]);
    const saved = await invoke<AIState>(IPC_CHANNELS.aiSaveProvider, providerPayload());
    const providerId = saved.ok ? (saved.value.settings.providers[0]?.id ?? '') : '';
    expect(await invoke<TurnResult>(IPC_CHANNELS.aiRunTurn, turnPayload(providerId))).toEqual({ ok: true, value: { text: 'Hi there', toolCalls: [], stopReason: 'end' } });
    expect(events).toEqual([{ requestId: 'r1', delta: 'Hi there' }]);
  });

  it('cancels a model request that is running', async () => {
    const { invoke } = await setup([json({ data: [] }), hanging()]);
    const saved = await invoke<AIState>(IPC_CHANNELS.aiSaveProvider, providerPayload());
    const providerId = saved.ok ? (saved.value.settings.providers[0]?.id ?? '') : '';
    const pending = invoke(IPC_CHANNELS.aiRunTurn, turnPayload(providerId));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await invoke(IPC_CHANNELS.aiCancelTurn, { requestId: 'r1' })).toEqual({ ok: true, value: undefined });
    expect(await pending).toMatchObject({ ok: false, error: { code: 'AI_CANCELLED' } });
  });

  it('rejects malformed payloads on every channel', async () => {
    const { invoke } = await setup([]);
    const bad: [string, unknown][] = [
      [IPC_CHANNELS.aiSaveProvider, undefined],
      [IPC_CHANNELS.aiSaveProvider, providerPayload({ kind: 'mystery' })],
      [IPC_CHANNELS.aiSaveProvider, providerPayload({ apiKey: 42 })],
      [IPC_CHANNELS.aiSaveProvider, providerPayload({ manualModels: 'x' })],
      [IPC_CHANNELS.aiSaveProvider, providerPayload({ name: 'x'.repeat(500) })],
      [IPC_CHANNELS.aiTestProvider, 'text'],
      [IPC_CHANNELS.aiRemoveProvider, {}],
      [IPC_CHANNELS.aiRefreshModels, { providerId: 5 }],
      [IPC_CHANNELS.aiUpdatePreferences, []],
      [IPC_CHANNELS.aiUpdatePreferences, { selection: { providerId: 1 } }],
      [IPC_CHANNELS.aiRunTurn, undefined],
      [IPC_CHANNELS.aiRunTurn, turnPayload('p', { messages: [{ role: 'root', content: 'x' }] })],
      [IPC_CHANNELS.aiRunTurn, turnPayload('p', { tools: [{ name: 1 }] })],
      [IPC_CHANNELS.aiRunTurn, turnPayload('p', { system: 'x'.repeat(300_000) })],
      [IPC_CHANNELS.aiRunTurn, turnPayload('p', { requestId: 7 })],
      [IPC_CHANNELS.aiCancelTurn, null],
      [IPC_CHANNELS.aiLoadConversation, { id: '../../settings' }],
      [IPC_CHANNELS.aiDeleteConversation, { id: 'a/b' }],
      [IPC_CHANNELS.aiRenameConversation, { id: 'conversation-a' }],
      [IPC_CHANNELS.aiSaveConversation, { id: 'conversation-a' }],
      [IPC_CHANNELS.aiSaveMcpServer, { name: 'x', transport: 'shell', command: 'sh' }],
      [IPC_CHANNELS.aiSaveMcpServer, { name: 'x', transport: 'stdio', command: 'sh', args: [1] }],
      [IPC_CHANNELS.aiConnectMcpServer, {}],
      [IPC_CHANNELS.aiCallMcpTool, { serverId: 's', tool: 't', input: 'x' }]
    ];
    for (const [channel, payload] of bad) {
      expect(await invoke(channel, payload), `${channel} ${JSON.stringify(payload)?.slice(0, 60)}`).toMatchObject({ ok: false, error: { code: expect.stringMatching(/INVALID_REQUEST|AI_INVALID_CONFIG/) } });
    }
  });

  it('stores conversations separately from the project, through validated requests', async () => {
    const { invoke, directory } = await setup([]);
    const conversation: Conversation = { id: 'conversation-a', title: 'Chat', createdAt: '2026-10-13T10:00:00.000Z', updatedAt: '2026-10-13T10:00:00.000Z', providerId: null, modelId: null, entries: [] };
    expect(await invoke(IPC_CHANNELS.aiSaveConversation, conversation)).toEqual({ ok: true, value: undefined });
    expect(await invoke(IPC_CHANNELS.aiListConversations)).toMatchObject({ ok: true, value: [{ id: 'conversation-a', title: 'Chat', entryCount: 0 }] });
    expect(await invoke(IPC_CHANNELS.aiRenameConversation, { id: 'conversation-a', title: 'Renamed' })).toEqual({ ok: true, value: undefined });
    expect(await invoke(IPC_CHANNELS.aiLoadConversation, { id: 'conversation-a' })).toMatchObject({ ok: true, value: { title: 'Renamed' } });
    expect(await invoke(IPC_CHANNELS.aiClearConversations)).toEqual({ ok: true, value: 1 });
    expect(await invoke(IPC_CHANNELS.aiLoadConversation, { id: 'conversation-a' })).toEqual({ ok: true, value: null });
    expect(directory).toContain('ai');
  });

  it('reads only the files the user picked, and reports what it could not attach', async () => {
    const root = await makeTempDir();
    const note = path.join(root, 'note.md');
    const secret = path.join(root, 'secret.exe');
    await writeFile(note, '# Hello');
    await writeFile(secret, 'MZ');
    const { invoke } = await setup([], [note, secret]);
    const result = await invoke<AttachmentPickResult>(IPC_CHANNELS.aiPickAttachments);
    expect(result).toMatchObject({ ok: true, value: { attachments: [{ name: 'note.md', kind: 'text', data: '# Hello' }], rejected: [{ name: 'secret.exe' }] } });
    const none = await setup([], []);
    expect(await none.invoke(IPC_CHANNELS.aiPickAttachments)).toEqual({ ok: true, value: { attachments: [], rejected: [] } });
  });

  it('manages MCP servers and refuses to connect one that is not trusted', async () => {
    const { invoke } = await setup([]);
    const saved = await invoke<AIState>(IPC_CHANNELS.aiSaveMcpServer, { id: null, name: 'Tools', transport: 'stdio', command: 'my-server', args: [], enabled: true, trusted: false, authToken: null });
    const serverId = saved.ok ? (saved.value.settings.mcpServers[0]?.id ?? '') : '';
    expect(saved.ok && saved.value.settings.mcpServers[0]).toMatchObject({ name: 'Tools', trusted: false });
    expect(await invoke(IPC_CHANNELS.aiConnectMcpServer, { serverId })).toMatchObject({ ok: false, error: { code: 'AI_MCP_ERROR' } });
    expect(await invoke<McpServerStatus[]>(IPC_CHANNELS.aiListMcpServers)).toMatchObject({ ok: true, value: [{ id: serverId, state: 'disconnected', commandLine: 'my-server' }] });
    expect(await invoke(IPC_CHANNELS.aiListMcpTools)).toEqual({ ok: true, value: [] });
    expect(await invoke(IPC_CHANNELS.aiCallMcpTool, { serverId, tool: 'x', input: {} })).toMatchObject({ ok: false, error: { code: 'AI_MCP_ERROR' } });
    const removed = await invoke<AIState>(IPC_CHANNELS.aiRemoveMcpServer, { serverId });
    expect(removed.ok && removed.value.settings.mcpServers).toEqual([]);
  });
});
