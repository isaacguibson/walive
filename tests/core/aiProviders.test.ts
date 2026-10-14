import { describe, expect, it } from 'vitest';
import { AppError } from '@core/errors';
import { AnthropicAdapter } from '@core/ai/providers/anthropicAdapter';
import { OpenAiAdapter } from '@core/ai/providers/openAiAdapter';
import { createDefaultProviderRegistry, normalizeBaseUrl } from '@core/ai/providers/registry';
import type { ProviderConnection, TurnParams } from '@core/ai/providers/adapter';
import type { ChatMessage } from '@shared/ai/types';
import { fakeFetch, hanging, json, sse } from '../helpers/http';

const KEY = 'sk-test-SECRET-9876';
const signal = () => new AbortController().signal;
const connection = (overrides: Partial<ProviderConnection> = {}): ProviderConnection => ({ providerId: 'p1', baseUrl: 'https://api.example.com/v1', apiKey: KEY, manualModels: [], ...overrides });
const turn = (overrides: Partial<TurnParams> = {}): TurnParams => ({
  modelId: 'gpt-4o',
  effort: null,
  system: 'Be brief',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
  tools: [],
  ...overrides
});
const code = async (promise: Promise<unknown>): Promise<string | undefined> => promise.then(() => undefined, (error: unknown) => (error instanceof AppError ? error.code : 'NOT_AN_APP_ERROR'));

const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ delta, finish_reason: finish }] });

describe('OpenAI adapter', () => {
  it('streams the answer and sends the request in the provider format', async () => {
    const { fetch, requests } = fakeFetch(sse([chunk({ content: 'Hel' }), chunk({ content: 'lo' }), chunk({}, 'stop'), '[DONE]']));
    const deltas: string[] = [];
    const result = await new OpenAiAdapter(fetch, true).runTurn(connection(), turn(), (text) => deltas.push(text), signal());
    expect(result).toEqual({ text: 'Hello', toolCalls: [], stopReason: 'end' });
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(requests[0]).toMatchObject({
      url: 'https://api.example.com/v1/chat/completions',
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}` },
      body: { model: 'gpt-4o', stream: true, messages: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: [{ type: 'text', text: 'Hello' }] }] }
    });
    expect(requests[0]?.body).not.toHaveProperty('tools');
    expect(requests[0]?.body).not.toHaveProperty('reasoning_effort');
  });

  it('survives events that are split across reads', async () => {
    const { fetch } = fakeFetch(sse([chunk({ content: 'Split' }), chunk({}, 'stop'), '[DONE]'], { chunkSize: 7 }));
    const result = await new OpenAiAdapter(fetch, true).runTurn(connection(), turn(), () => undefined, signal());
    expect(result.text).toBe('Split');
  });

  it('assembles tool calls that arrive in fragments, and keeps unparseable arguments as null', async () => {
    const { fetch } = fakeFetch(
      sse([
        chunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'draw', arguments: '{"x":' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '1}' } }, { index: 1, id: 'call_2', function: { name: 'bad', arguments: '{oops' } }] }),
        chunk({}, 'tool_calls')
      ])
    );
    const result = await new OpenAiAdapter(fetch, true).runTurn(connection(), turn({ tools: [{ name: 'draw', description: 'd', inputSchema: { type: 'object' } }] }), () => undefined, signal());
    expect(result.stopReason).toBe('tool_calls');
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'draw', input: { x: 1 } },
      { id: 'call_2', name: 'bad', input: null }
    ]);
  });

  it('describes tools, tool calls, tool results and images in the provider format', async () => {
    const { fetch, requests } = fakeFetch(sse([chunk({}, 'stop')]));
    const messages: ChatMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image', mediaType: 'image/png', data: 'AAAA' }] },
      { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'draw', input: { a: 1 } }] },
      { role: 'tool', toolCallId: 'c1', name: 'draw', content: '{"ok":true}', isError: false }
    ];
    await new OpenAiAdapter(fetch, true).runTurn(connection(), turn({ messages, tools: [{ name: 'draw', description: 'Draws', inputSchema: { type: 'object' } }] }), () => undefined, signal());
    const body = requests[0]?.body as { messages: unknown[]; tools: unknown[] };
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'draw', description: 'Draws', parameters: { type: 'object' } } }]);
    expect(body.messages.slice(1)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'draw', arguments: '{"a":1}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' }
    ]);
  });

  it.each([
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['max', 'high']
  ] as const)('maps the %s effort to the provider value %s', async (effort, expected) => {
    const { fetch, requests } = fakeFetch(sse([chunk({}, 'stop')]));
    await new OpenAiAdapter(fetch, true).runTurn(connection(), turn({ effort }), () => undefined, signal());
    expect(requests[0]?.body).toMatchObject({ reasoning_effort: expected });
  });

  it('also accepts servers that answer with a plain JSON body', async () => {
    const { fetch } = fakeFetch(json({ choices: [{ message: { content: 'Plain', tool_calls: [{ id: 't', function: { name: 'x', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }));
    const deltas: string[] = [];
    const result = await new OpenAiAdapter(fetch, false).runTurn(connection(), turn(), (text) => deltas.push(text), signal());
    expect(result).toEqual({ text: 'Plain', toolCalls: [{ id: 't', name: 'x', input: {} }], stopReason: 'tool_calls' });
    expect(deltas).toEqual(['Plain']);
  });

  it('sends no authorization header when a compatible server has no key', async () => {
    const { fetch, requests } = fakeFetch(sse([chunk({}, 'stop')]));
    await new OpenAiAdapter(fetch, false).runTurn(connection({ apiKey: null }), turn(), () => undefined, signal());
    expect(requests[0]?.headers).not.toHaveProperty('Authorization');
  });

  it.each([
    [401, 'AI_AUTH_FAILED'],
    [403, 'AI_AUTH_FAILED'],
    [404, 'AI_NOT_FOUND'],
    [429, 'AI_RATE_LIMITED'],
    [500, 'AI_PROVIDER_ERROR'],
    [400, 'AI_UNSUPPORTED']
  ] as const)('maps HTTP %i to %s', async (status, expected) => {
    const { fetch } = fakeFetch(json({ error: { message: 'nope' } }, status));
    expect(await code(new OpenAiAdapter(fetch, true).runTurn(connection(), turn(), () => undefined, signal()))).toBe(expected);
  });

  it('recognizes a request that is larger than the model allows', async () => {
    const { fetch } = fakeFetch(json({ error: { message: "This model's maximum context length is 128000 tokens" } }, 400));
    expect(await code(new OpenAiAdapter(fetch, true).runTurn(connection(), turn(), () => undefined, signal()))).toBe('AI_CONTEXT_LIMIT');
  });

  it('never repeats the key, even when the provider echoes it back', async () => {
    const { fetch } = fakeFetch(json({ error: { message: `Incorrect API key provided: ${KEY}` } }, 401));
    const error = await new OpenAiAdapter(fetch, true).runTurn(connection(), turn(), () => undefined, signal()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).not.toContain(KEY);
    expect((error as AppError).message).toContain('[redacted]');
  });

  it('reports a network failure without technical details', async () => {
    const { fetch } = fakeFetch(new TypeError('fetch failed: ECONNREFUSED 10.0.0.5'));
    const error = await new OpenAiAdapter(fetch, true).runTurn(connection(), turn(), () => undefined, signal()).catch((caught: unknown) => caught);
    expect((error as AppError).code).toBe('AI_NETWORK');
    expect((error as AppError).message).not.toContain('10.0.0.5');
  });

  it('reports cancellation when the request is aborted', async () => {
    const controller = new AbortController();
    const { fetch } = fakeFetch(hanging());
    const pending = new OpenAiAdapter(fetch, true).runTurn(connection(), turn(), () => undefined, controller.signal);
    controller.abort();
    expect(await code(pending)).toBe('AI_CANCELLED');
  });

  it('does not return a partial answer when the stream is interrupted', async () => {
    const { fetch } = fakeFetch(sse([chunk({ content: 'Half an ans' })]));
    expect(await code(new OpenAiAdapter(fetch, true).runTurn(connection(), turn(), () => undefined, signal()))).toBe('AI_NETWORK');
  });

  it('fails when the provider reports an error in the middle of the stream', async () => {
    const { fetch } = fakeFetch(sse([chunk({ content: 'Start' }), { error: { message: 'overloaded' } }]));
    expect(await code(new OpenAiAdapter(fetch, true).runTurn(connection(), turn(), () => undefined, signal()))).toBe('AI_PROVIDER_ERROR');
  });
});

describe('OpenAI model discovery', () => {
  it('lists chat models with the capabilities that are known, and leaves the rest unknown', async () => {
    const { fetch, requests } = fakeFetch(json({ data: [{ id: 'gpt-4o' }, { id: 'o3' }, { id: 'o3-mini' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'ft:custom-model' }] }));
    const models = await new OpenAiAdapter(fetch, true).listModels(connection(), signal());
    expect(requests[0]).toMatchObject({ url: 'https://api.example.com/v1/models', method: 'GET' });
    expect(models.map((model) => model.id)).toEqual(['gpt-4o', 'o3', 'o3-mini', 'ft:custom-model']);
    const byId = Object.fromEntries(models.map((model) => [model.id, model.capabilities]));
    expect(byId['gpt-4o']).toMatchObject({ tools: 'yes', image: 'yes', streaming: 'yes', efforts: [] });
    expect(byId['o3']).toMatchObject({ efforts: ['low', 'medium', 'high'], image: 'yes' });
    expect(byId['o3-mini']).toMatchObject({ efforts: ['low', 'medium', 'high'], image: 'no' });
    expect(byId['ft:custom-model']).toEqual({ tools: 'unknown', image: 'unknown', streaming: 'unknown', efforts: [], contextWindow: null });
    expect(models.every((model) => model.providerId === 'p1' && model.available && model.source === 'catalog')).toBe(true);
  });

  it('claims nothing about the models of a compatible server', async () => {
    const { fetch } = fakeFetch(json({ data: [{ id: 'llama-3' }] }));
    const [model] = await new OpenAiAdapter(fetch, false).listModels(connection(), signal());
    expect(model).toMatchObject({ id: 'llama-3', source: 'provider', capabilities: { tools: 'unknown', image: 'unknown', streaming: 'unknown', efforts: [] } });
  });

  it('treats a compatible server without a model list as having no discovered models', async () => {
    const { fetch } = fakeFetch(json({ error: { message: 'not found' } }, 404));
    expect(await new OpenAiAdapter(fetch, false).listModels(connection(), signal())).toEqual([]);
    const strict = fakeFetch(json({ error: { message: 'not found' } }, 404));
    expect(await code(new OpenAiAdapter(strict.fetch, true).listModels(connection(), signal()))).toBe('AI_NOT_FOUND');
  });

  it('requires a key for the official API', async () => {
    const { fetch, requests } = fakeFetch();
    expect(await code(new OpenAiAdapter(fetch, true).validate(connection({ apiKey: null }), signal()))).toBe('AI_NOT_CONFIGURED');
    expect(requests).toHaveLength(0);
  });
});

describe('Anthropic adapter', () => {
  const connectionFor = connection({ baseUrl: 'https://api.anthropic.com' });
  const modelParams = turn({ modelId: 'claude-sonnet' });

  it('streams text and assembles tool use, sending the request in the provider format', async () => {
    const { fetch, requests } = fakeFetch(
      sse([
        { type: 'message_start' },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Drawing' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'draw' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"x":' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '5}' } },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
        { type: 'message_stop' }
      ])
    );
    const deltas: string[] = [];
    const result = await new AnthropicAdapter(fetch).runTurn(connectionFor, { ...modelParams, effort: 'high', tools: [{ name: 'draw', description: 'Draws', inputSchema: { type: 'object' } }] }, (text) => deltas.push(text), signal());
    expect(result).toEqual({ text: 'Drawing', toolCalls: [{ id: 'tu_1', name: 'draw', input: { x: 5 } }], stopReason: 'tool_calls' });
    expect(deltas).toEqual(['Drawing']);
    expect(requests[0]).toMatchObject({
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: { model: 'claude-sonnet', system: 'Be brief', stream: true, tools: [{ name: 'draw', description: 'Draws', input_schema: { type: 'object' } }] }
    });
    // No Claude model is claimed to take an effort level, so none is sent.
    expect(JSON.stringify(requests[0]?.body)).not.toContain('high');
  });

  it('merges tool results into one user turn and sends images as base64 sources', async () => {
    const { fetch, requests } = fakeFetch(sse([{ type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }]));
    const messages: ChatMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image', mediaType: 'image/png', data: 'AAAA' }] },
      { role: 'assistant', text: 'Checking', toolCalls: [{ id: 'a', name: 'x', input: {} }, { id: 'b', name: 'y', input: null }] },
      { role: 'tool', toolCallId: 'a', name: 'x', content: 'one', isError: false },
      { role: 'tool', toolCallId: 'b', name: 'y', content: 'two', isError: true },
      { role: 'user', content: [{ type: 'text', text: 'Images from tools' }] }
    ];
    await new AnthropicAdapter(fetch).runTurn(connectionFor, { ...modelParams, messages }, () => undefined, signal());
    const body = requests[0]?.body as { messages: { role: string; content: unknown[] }[] };
    expect(body.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(body.messages[0]?.content).toEqual([{ type: 'text', text: 'Look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]);
    expect(body.messages[1]?.content).toEqual([{ type: 'text', text: 'Checking' }, { type: 'tool_use', id: 'a', name: 'x', input: {} }, { type: 'tool_use', id: 'b', name: 'y', input: {} }]);
    expect(body.messages[2]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'one', is_error: false },
      { type: 'tool_result', tool_use_id: 'b', content: 'two', is_error: true },
      { type: 'text', text: 'Images from tools' }
    ]);
  });

  it.each([
    ['end_turn', 'end'],
    ['max_tokens', 'length']
  ] as const)('maps the stop reason %s', async (reason, expected) => {
    const { fetch } = fakeFetch(sse([{ type: 'message_delta', delta: { stop_reason: reason } }, { type: 'message_stop' }]));
    expect((await new AnthropicAdapter(fetch).runTurn(connectionFor, modelParams, () => undefined, signal())).stopReason).toBe(expected);
  });

  it('fails on a stream error event or an interrupted stream', async () => {
    const failing = fakeFetch(sse([{ type: 'error', error: { message: 'overloaded' } }]));
    expect(await code(new AnthropicAdapter(failing.fetch).runTurn(connectionFor, modelParams, () => undefined, signal()))).toBe('AI_PROVIDER_ERROR');
    const cut = fakeFetch(sse([{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half' } }]));
    expect(await code(new AnthropicAdapter(cut.fetch).runTurn(connectionFor, modelParams, () => undefined, signal()))).toBe('AI_NETWORK');
  });

  it('lists models with their display names and the capabilities of the Claude family', async () => {
    const { fetch, requests } = fakeFetch(json({ data: [{ id: 'claude-sonnet', display_name: 'Claude Sonnet' }, { id: 'other', display_name: 'Other' }] }));
    const models = await new AnthropicAdapter(fetch).listModels(connectionFor, signal());
    expect(requests[0]?.url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(models[0]).toMatchObject({ id: 'claude-sonnet', displayName: 'Claude Sonnet', capabilities: { tools: 'yes', image: 'yes', streaming: 'yes', efforts: [] } });
    expect(models[1]?.capabilities).toMatchObject({ tools: 'unknown', image: 'unknown' });
  });

  it('maps authentication failures and requires a key', async () => {
    const { fetch } = fakeFetch(json({ error: { message: 'invalid x-api-key' } }, 401));
    expect(await code(new AnthropicAdapter(fetch).validate(connectionFor, signal()))).toBe('AI_AUTH_FAILED');
    expect(await code(new AnthropicAdapter(fakeFetch().fetch).validate({ ...connectionFor, apiKey: null }, signal()))).toBe('AI_NOT_CONFIGURED');
  });
});

describe('provider registry', () => {
  it('resolves adapters by kind and lists every provider with what it needs', () => {
    const registry = createDefaultProviderRegistry(fakeFetch().fetch);
    expect(registry.resolve('openai').descriptor.kind).toBe('openai');
    expect(registry.resolve('anthropic').descriptor.kind).toBe('anthropic');
    expect(registry.resolve('openai-compatible').descriptor.customEndpoint).toBe('required');
    const descriptors = registry.descriptors();
    expect(descriptors.map((descriptor) => descriptor.kind).sort()).toEqual(['anthropic', 'copilot', 'openai', 'openai-compatible']);
    expect(descriptors.find((descriptor) => descriptor.kind === 'openai')?.authHelp).toContain('ChatGPT subscription does not include API access');
    expect(descriptors.find((descriptor) => descriptor.kind === 'anthropic')?.authHelp).toContain('Claude subscription does not include API access');
  });

  it('lists GitHub Copilot as unavailable, with the reason, and cannot resolve it', () => {
    const registry = createDefaultProviderRegistry(fakeFetch().fetch);
    expect(registry.descriptors().find((descriptor) => descriptor.kind === 'copilot')).toMatchObject({ available: false, unavailableReason: expect.stringContaining('officially supported') });
    expect(() => registry.resolve('copilot')).toThrow(AppError);
  });

  it('accepts a new adapter without changes elsewhere', async () => {
    const registry = createDefaultProviderRegistry(fakeFetch().fetch);
    const custom = new OpenAiAdapter(fakeFetch().fetch, false);
    registry.register({ ...custom, descriptor: { ...custom.descriptor, kind: 'copilot', available: true }, validate: custom.validate.bind(custom), listModels: custom.listModels.bind(custom), runTurn: custom.runTurn.bind(custom) });
    expect(registry.resolve('copilot').descriptor.available).toBe(true);
  });
});

describe('endpoint validation', () => {
  it('normalizes valid endpoints', () => {
    expect(normalizeBaseUrl(' https://api.example.com/v1/ ')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(normalizeBaseUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });

  it.each(['not a url', 'http://example.com/v1', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com/v1?key=1', 'https://example.com/#x', 'javascript:alert(1)'])('rejects %s', (value) => {
    expect(() => normalizeBaseUrl(value)).toThrow(AppError);
  });
});
