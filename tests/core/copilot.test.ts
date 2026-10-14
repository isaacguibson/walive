import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { CopilotClient, type CopilotClientOptions, type ModelInfo as SdkModel, type SessionConfig, type Tool } from '@github/copilot-sdk';
import { GitHubCopilotRuntimeService, normalizeCopilotModel, restrictedCopilotSession, copilotError } from '@core/ai/providers/copilotRuntime';
import { GitHubCopilotAuthenticationService } from '@core/ai/providers/copilotAuthentication';
import { GitHubCopilotSessionService } from '@core/ai/providers/copilotSessionService';
import { GitHubCopilotProviderAdapter } from '@core/ai/providers/githubCopilotProviderAdapter';
import type { CopilotEvent, CopilotRequest } from '@shared/ai/copilot';
import { createAiServices } from '../helpers/ai';
import { fakeFetch, json } from '../helpers/http';
import { makeTempDir } from '../helpers/tempDir';

const model: SdkModel = { id: 'test-model', name: 'Test Model', capabilities: { supports: { vision: true, reasoningEffort: true }, limits: { max_context_window_tokens: 128_000 } }, policy: { state: 'enabled', terms: '' }, supportedReasoningEfforts: ['low', 'high', 'xhigh'] };

function sdkFake() {
  const listeners = new Set<(event: { type: string; data: Record<string, unknown> }) => void>();
  let config: SessionConfig = {};
  const emit = (type: string, data: Record<string, unknown> = {}) => listeners.forEach((listener) => listener({ type, data }));
  const session = {
    sessionId: 'sdk-session-1',
    on: vi.fn((listener: (event: { type: string; data: Record<string, unknown> }) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
    send: vi.fn(async (_input: unknown) => {
      emit('assistant.turn_start');
      emit('assistant.message_delta', { deltaContent: 'Hello' });
      emit('assistant.message', { content: 'Hello' });
      emit('session.idle');
      return 'message-1';
    }),
    abort: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined)
  };
  const client = {
    ping: vi.fn(async () => ({ message: 'ok', timestamp: Date.now() })),
    start: vi.fn(async () => undefined), stop: vi.fn(async () => []), forceStop: vi.fn(async () => undefined),
    getAuthStatus: vi.fn(async () => ({ isAuthenticated: true, login: 'test-user' })),
    listModels: vi.fn(async () => [model]),
    createSession: vi.fn(async (input: SessionConfig) => { config = input; return session; }),
    resumeSession: vi.fn(async (_id: string, input: SessionConfig) => { config = input; return session; })
  };
  const options: CopilotClientOptions[] = [];
  const factory = (input: CopilotClientOptions) => { options.push(input); return client as unknown as CopilotClient; };
  return { client, session, factory, options, emit, config: () => config };
}

async function setup() {
  const root = await makeTempDir();
  const fake = sdkFake();
  const services = createAiServices(root);
  const runtime = new GitHubCopilotRuntimeService(path.join(root, 'runtime'), fake.factory);
  services.providers.register(new GitHubCopilotProviderAdapter(runtime));
  const auth = new GitHubCopilotAuthenticationService(services.credentials, fakeFetch().fetch);
  const sessions = new GitHubCopilotSessionService(runtime, auth, services.settings, path.join(root, 'sessions.json'));
  const provider = await services.settings.saveProvider({ id: null, kind: 'copilot', name: 'Copilot', baseUrl: null, apiKey: null, manualModels: [] });
  await services.settings.setCopilotConnected(provider.id, true);
  const request: CopilotRequest = { requestId: 'request-1', conversationId: 'conversation-1', providerId: provider.id, modelId: model.id, effort: 'high', system: 'Project Studio, scene Intro', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }], tools: [{ name: 'add_frame', description: 'Adds one frame', inputSchema: { type: 'object', additionalProperties: false } }] };
  const events: CopilotEvent[] = [];
  return { ...services, root, fake, runtime, auth, sessions, provider, request, events, run: () => sessions.run(request, (event) => events.push(event)) };
}

describe('Copilot runtime', () => {
  it('provides the persistence directory required by the real SDK for CLI-account connections', async () => {
    const { fake, runtime, provider, root } = await setup();
    await runtime.client(provider.id, null);
    expect(fake.options[0]).toMatchObject({ mode: 'empty', useLoggedInUser: true, baseDirectory: path.join(root, 'runtime', 'state') });
    expect(() => new CopilotClient(fake.options[0])).not.toThrow();
    await runtime.close();
  });
  it('recreates an unhealthy runtime without replaying a project operation', async () => {
    const { fake, runtime, provider } = await setup();
    await runtime.client(provider.id, null);
    fake.client.ping.mockRejectedValueOnce(new Error('runtime terminated'));
    await runtime.client(provider.id, null);
    expect(fake.client.start).toHaveBeenCalledTimes(2);
    expect(fake.client.createSession).not.toHaveBeenCalled();
    await runtime.close();
  });
  it('initializes lazily, shares concurrent initialization, and shuts down', async () => {
    const { fake, runtime, provider } = await setup();
    expect(fake.client.start).not.toHaveBeenCalled();
    await Promise.all([runtime.client(provider.id, null), runtime.client(provider.id, null)]);
    expect(fake.client.start).toHaveBeenCalledTimes(1);
    expect(fake.options[0]).toMatchObject({ mode: 'empty', logLevel: 'none', enableRemoteSessions: false });
    expect(fake.options[0]?.env).not.toHaveProperty('GITHUB_TOKEN');
    await runtime.close();
    expect(fake.client.stop).toHaveBeenCalledTimes(1);
  });

  it('maps authentication, entitlement and startup failures without exposing raw error data', async () => {
    const { fake, runtime, provider } = await setup();
    fake.client.getAuthStatus.mockResolvedValueOnce({ isAuthenticated: false, login: '' });
    expect(await runtime.connect(provider.id, null)).toMatchObject({ state: 'authentication-required' });
    fake.client.listModels.mockRejectedValueOnce(new Error('403 entitlement missing secret ghp_NOT_FOR_LOGS'));
    const status = await runtime.connect(provider.id, null);
    expect(status).toMatchObject({ state: 'missing-entitlement' });
    expect(status.message).not.toContain('NOT_FOR_LOGS');
    fake.client.start.mockRejectedValueOnce(new Error('missing runtime secret'));
    expect(await runtime.connect(provider.id, null)).toMatchObject({ state: 'error' });
    await runtime.close();
  });

  it('disconnects the application without calling GitHub logout', async () => {
    const { runtime, provider, fake } = await setup();
    await runtime.connect(provider.id, null);
    await runtime.disconnect(provider.id);
    expect(runtime.status(provider.id)).toMatchObject({ state: 'disconnected' });
    expect(fake.client.stop).toHaveBeenCalled();
  });

  it('uses dynamic model metadata and preserves disabled models', () => {
    expect(normalizeCopilotModel('p', model)).toMatchObject({ id: model.id, displayName: model.name, available: true, capabilities: { image: 'yes', efforts: ['low', 'high'], contextWindow: 128_000 } });
    expect(normalizeCopilotModel('p', { ...model, policy: { state: 'disabled', terms: '' } }).available).toBe(false);
    expect(normalizeCopilotModel('p', { ...model, supportedReasoningEfforts: undefined }).capabilities.efforts).toEqual([]);
  });

  it('allows only custom application tools and denies all other permissions', () => {
    const config = restrictedCopilotSession('m', 's', [{ name: 'add_frame', handler: () => 'ok' }]);
    expect(config).toMatchObject({ availableTools: ['custom:add_frame'], excludedTools: ['builtin:*', 'mcp:*'], enableFileHooks: false, enableSkills: false, enableHostGitOperations: false, enableConfigDiscovery: false, enableSessionStore: false });
    expect(config.onPermissionRequest?.({ kind: 'shell', toolCallId: '1', fullCommandText: 'rm -rf /' } as never, {} as never)).toMatchObject({ kind: 'reject' });
  });

  it.each([['401', 'AI_AUTH_FAILED'], ['429 quota', 'AI_RATE_LIMITED'], ['model unavailable', 'AI_NOT_FOUND'], ['ECONNRESET', 'AI_NETWORK']])('normalizes %s', (message, code) => {
    expect(copilotError(new Error(message)).code).toBe(code);
  });
});

describe('Copilot SDK sessions', () => {
  it('passes supported preview images as SDK binary tool results', async () => {
    const { fake, sessions, request, runtime } = await setup();
    fake.session.send.mockImplementationOnce(async () => {
      const result = await fake.config().tools?.[0]?.handler?.({}, { toolCallId: 'preview-1' } as never);
      expect(result).toMatchObject({ resultType: 'success', binaryResultsForLlm: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] });
      fake.emit('session.idle');
      return 'message-1';
    });
    await sessions.run(request, (event) => {
      if (event.kind === 'tool') sessions.result({ requestId: event.requestId, callId: event.call.id, content: '{}', isError: false, images: [{ data: 'AAAA', mediaType: 'image/png' }] });
    });
    await runtime.close();
  });

  it('enforces the SDK model-turn limit and aborts further execution', async () => {
    const { fake, request, settings, run, runtime } = await setup();
    const current = await settings.get();
    await settings.updatePreferences({ limits: { ...current.limits, maxIterations: 1 } });
    fake.session.send.mockImplementationOnce(async () => {
      fake.emit('assistant.turn_start');
      fake.emit('assistant.turn_start');
      return 'message-1';
    });
    expect(await run()).toMatchObject({ status: 'limit', error: { code: 'AI_LIMIT_REACHED' } });
    expect(fake.session.abort).toHaveBeenCalled();
    await runtime.close();
  });

  it('never marks a failed application tool as successful', async () => {
    const { fake, sessions, request, runtime } = await setup();
    fake.session.send.mockImplementationOnce(async () => {
      const result = await fake.config().tools?.[0]?.handler?.({}, { toolCallId: 'denied-1' } as never);
      expect(result).toMatchObject({ resultType: 'failure', textResultForLlm: 'User rejected this operation.' });
      fake.emit('session.idle');
      return 'message-1';
    });
    await sessions.run(request, (event) => {
      if (event.kind === 'tool') sessions.result({ requestId: event.requestId, callId: event.call.id, content: 'User rejected this operation.', isError: true });
    });
    await runtime.close();
  });
  it('streams into normalized events and ends the session cleanly', async () => {
    const { run, fake, events, runtime } = await setup();
    expect(await run()).toMatchObject({ status: 'completed', iterations: 1, toolCalls: 0 });
    expect(events).toContainEqual(expect.objectContaining({ kind: 'event', event: { type: 'text-delta', text: 'Hello' } }));
    expect(fake.config()).toMatchObject({ reasoningEffort: 'high', streaming: true });
    expect(fake.session.disconnect).toHaveBeenCalled();
    await runtime.close();
  });

  it('registers tools, waits for validated application results, and never claims success early', async () => {
    const { fake, sessions, request, events, runtime } = await setup();
    fake.session.send.mockImplementationOnce(async () => {
      const tool = fake.config().tools?.[0] as Tool;
      const result = await tool.handler?.({}, { toolCallId: 'call-1' } as never);
      expect(result).toMatchObject({ resultType: 'success', textResultForLlm: '{"frameId":"f2"}' });
      fake.emit('assistant.message', { content: 'Frame added.' });
      fake.emit('session.idle');
      return 'message-1';
    });
    const running = sessions.run(request, (event) => {
      events.push(event);
      if (event.kind === 'tool') sessions.result({ requestId: event.requestId, callId: event.call.id, content: '{"frameId":"f2"}', isError: false });
    });
    expect(await running).toMatchObject({ status: 'completed', toolCalls: 1 });
    expect(events).toContainEqual({ requestId: request.requestId, kind: 'tool', call: { id: 'call-1', name: 'add_frame', input: {} } });
    await runtime.close();
  });

  it('rejects bad tool arguments before contacting the editor', async () => {
    const { fake, run, events, runtime } = await setup();
    fake.session.send.mockImplementationOnce(async () => {
      const result = await fake.config().tools?.[0]?.handler?.({ unexpected: true }, { toolCallId: 'call-1' } as never);
      expect(result).toMatchObject({ resultType: 'failure' });
      fake.emit('session.idle');
      return 'message-1';
    });
    await run();
    expect(events.filter((event) => event.kind === 'tool')).toEqual([]);
    await runtime.close();
  });

  it('resumes compatible sessions and rebuilds history if resume fails', async () => {
    const { run, fake, runtime } = await setup();
    await run();
    await run();
    expect(fake.client.resumeSession).toHaveBeenCalledWith('sdk-session-1', expect.objectContaining({ excludedTools: ['builtin:*', 'mcp:*'] }));
    fake.client.resumeSession.mockRejectedValueOnce(new Error('expired'));
    await run();
    expect(fake.client.createSession).toHaveBeenCalledTimes(2);
    await runtime.close();
  });

  it('refuses unavailable models and effort levels before creating a session', async () => {
    const { run, fake, request, runtime } = await setup();
    request.modelId = 'missing';
    expect(await run()).toMatchObject({ status: 'failed', error: { code: 'AI_NOT_FOUND' } });
    request.modelId = model.id;
    request.effort = 'medium';
    expect(await run()).toMatchObject({ status: 'failed', error: { code: 'AI_UNSUPPORTED' } });
    expect(fake.client.createSession).not.toHaveBeenCalled();
    await runtime.close();
  });

  it('cancels a running request and stops queued tools', async () => {
    const { fake, sessions, request, runtime } = await setup();
    fake.session.send.mockImplementationOnce(async () => 'message-1');
    const running = sessions.run(request, () => undefined);
    await vi.waitFor(() => expect(fake.session.send).toHaveBeenCalled());
    sessions.cancel(request.requestId);
    expect(await running).toMatchObject({ status: 'cancelled' });
    expect(fake.session.abort).toHaveBeenCalled();
    await runtime.close();
  });

  it('refuses a disconnected provider without launching the runtime', async () => {
    const { settings, provider, run, fake } = await setup();
    await settings.setCopilotConnected(provider.id, false);
    expect(await run()).toMatchObject({ status: 'failed', error: { code: 'AI_NOT_CONFIGURED' } });
    expect(fake.client.start).not.toHaveBeenCalled();
  });
});

describe('GitHub device authorization', () => {
  it('respects authorization_pending and slow_down polling intervals', async () => {
    const { credentials } = createAiServices(await makeTempDir());
    const http = fakeFetch(
      json({ device_code: 'private-code', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 }),
      json({ error: 'authorization_pending' }), json({ error: 'slow_down' }), json({ access_token: 'gho_FINAL1234' })
    );
    const wait = vi.fn(async (_ms: number, _signal: AbortSignal) => undefined);
    const auth = new GitHubCopilotAuthenticationService(credentials, http.fetch, wait);
    await auth.begin('p', 'registered-client');
    await auth.finish('p');
    expect(wait.mock.calls.map((call) => call[0])).toEqual([5_000, 5_000, 10_000]);
    expect(await auth.token('p')).toBe('gho_FINAL1234');
  });

  it('refreshes an expired device-flow token without exposing it to the UI', async () => {
    const { credentials } = createAiServices(await makeTempDir());
    await credentials.set('copilot:p', JSON.stringify({ accessToken: 'gho_OLD1234', refreshToken: 'ghr_SECRET', clientId: 'registered-client', expiresAt: Date.now() - 1 }));
    const http = fakeFetch(json({ access_token: 'gho_NEW1234', refresh_token: 'ghr_NEW', expires_in: 28800 }));
    const auth = new GitHubCopilotAuthenticationService(credentials, http.fetch);
    expect(await auth.token('p')).toBe('gho_NEW1234');
    expect(http.requests[0]?.body).toEqual({ client_id: 'registered-client', grant_type: 'refresh_token', refresh_token: 'ghr_SECRET' });
    expect(await auth.token('p')).toBe('gho_NEW1234');
    expect(http.requests).toHaveLength(1);
  });
  it('uses the registered app, never asks for repo scope, and stores the token encrypted', async () => {
    vi.useFakeTimers();
    try {
      const root = await makeTempDir();
      const { credentials, directory } = createAiServices(root);
      const http = fakeFetch(json({ device_code: 'private-code', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 }), json({ access_token: 'gho_SECRET1234', token_type: 'bearer' }));
      const wait = vi.fn(async () => undefined);
      const auth = new GitHubCopilotAuthenticationService(credentials, http.fetch, wait);
      const login = await auth.begin('p', 'registered-client');
      expect(login.userCode).toBe('ABCD-1234');
      expect(JSON.stringify(login)).not.toContain('private-code');
      const finished = auth.finish('p');
      await vi.advanceTimersByTimeAsync(5_001);
      await finished;
      expect(wait).toHaveBeenCalledWith(5_000, expect.any(AbortSignal));
      expect(http.requests[0]?.body).toEqual({ client_id: 'registered-client' });
      expect(await auth.token('p')).toBe('gho_SECRET1234');
      expect(await readFile(path.join(directory, 'credentials.json'), 'utf8')).not.toContain('gho_SECRET1234');
      await auth.disconnect('p');
      expect(await auth.token('p')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('rejects a missing Client ID without requesting a device code', async () => {
    const { credentials } = createAiServices(await makeTempDir());
    const http = fakeFetch();
    const auth = new GitHubCopilotAuthenticationService(credentials, http.fetch);
    await expect(auth.begin('p', '')).rejects.toMatchObject({ code: 'AI_INVALID_CONFIG' });
    expect(http.requests).toEqual([]);
  });
});