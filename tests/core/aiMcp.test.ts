import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@core/errors';
import { formatCommandLine, resolveExecutable, validateMcpServer } from '@core/ai/mcp/config';
import type { McpTransportFactory } from '@core/ai/mcp/mcpClientService';
import type { SaveMcpServerInput } from '@shared/ai/types';
import { createAiServices } from '../helpers/ai';
import { makeTempDir } from '../helpers/tempDir';

const stdio = (overrides: Partial<Extract<SaveMcpServerInput, { transport: 'stdio' }>> = {}): SaveMcpServerInput => ({
  id: null,
  name: 'Local tools',
  transport: 'stdio',
  command: 'my-server',
  args: ['--flag', 'two words'],
  enabled: true,
  trusted: true,
  authToken: null,
  ...overrides
});
const remote = (overrides: Partial<Extract<SaveMcpServerInput, { transport: 'http' }>> = {}): SaveMcpServerInput => ({
  id: null,
  name: 'Remote tools',
  transport: 'http',
  url: 'https://mcp.example.com/mcp',
  enabled: true,
  trusted: true,
  authToken: null,
  ...overrides
});

const code = async (promise: Promise<unknown>): Promise<string | undefined> => promise.then(() => undefined, (error: unknown) => (error instanceof AppError ? error.code : 'NOT_AN_APP_ERROR'));

interface FakeServer {
  transports: McpTransportFactory;
  launched: { command: string | null; token: string | null; args: string[] }[];
  clientCapabilities(): unknown;
  calls: Record<string, unknown>[];
}

/** A real MCP server over an in-memory pipe, with one tool that echoes and one that fails. */
function fakeServer(options: { failToConnect?: Error } = {}): FakeServer {
  const launched: FakeServer['launched'] = [];
  const calls: Record<string, unknown>[] = [];
  let lastServer: Server | undefined;
  const transports: McpTransportFactory = (config, executable, token) => {
    launched.push({ command: executable, token, args: config.transport === 'stdio' ? config.args : [] });
    if (options.failToConnect !== undefined) {
      throw options.failToConnect;
    }
    const server = new Server({ name: 'fake', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: 'echo', description: 'Echoes the text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } },
        { name: 'explode', description: 'Always reports an error', inputSchema: { type: 'object' } }
      ]
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      calls.push(request.params.arguments ?? {});
      if (request.params.name === 'explode') {
        return { isError: true, content: [{ type: 'text', text: 'Something broke' }] };
      }
      return { content: [{ type: 'text', text: `echo: ${String(request.params.arguments?.['text'])}` }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] };
    });
    const [client, serverSide] = InMemoryTransport.createLinkedPair();
    lastServer = server;
    void server.connect(serverSide);
    return client;
  };
  return { transports, launched, calls, clientCapabilities: () => lastServer?.getClientCapabilities() };
}

describe('MCP server configuration', () => {
  it('accepts local and remote servers and normalizes them', () => {
    expect(validateMcpServer(stdio({ name: '  Local  ', command: ' my-server ' }))).toEqual({ name: 'Local', enabled: true, trusted: true, transport: 'stdio', command: 'my-server', args: ['--flag', 'two words'] });
    expect(validateMcpServer(remote({ url: 'https://mcp.example.com/mcp/' }))).toMatchObject({ transport: 'http', url: 'https://mcp.example.com/mcp' });
    expect(validateMcpServer(remote({ url: 'http://localhost:8080/mcp' }))).toMatchObject({ url: 'http://localhost:8080/mcp' });
  });

  it('does not trust or enable a server unless the user said so', () => {
    expect(validateMcpServer(stdio({ trusted: false, enabled: false }))).toMatchObject({ trusted: false, enabled: false });
  });

  it.each([
    [stdio({ name: '' })],
    [stdio({ command: '   ' })],
    [stdio({ command: 'bad\ncommand' })],
    [stdio({ args: ['ok', 'bad\u0000arg'] })],
    [stdio({ args: Array.from({ length: 51 }, () => 'a') })],
    [remote({ url: 'http://mcp.example.com/mcp' })],
    [remote({ url: 'https://user:pw@mcp.example.com' })],
    [remote({ url: 'nope' })]
  ])('rejects an invalid configuration (%#)', (input) => {
    expect(() => validateMcpServer(input)).toThrow(AppError);
  });

  it('shows the command exactly as it will run', () => {
    expect(formatCommandLine('npx', ['-y', 'server', 'two words', 'say "hi"'])).toBe('npx -y server "two words" "say \\"hi\\""');
  });
});

describe('executable validation', () => {
  it('accepts an absolute path to an executable file and a command found on the PATH', async () => {
    const root = await makeTempDir();
    const bin = path.join(root, 'bin');
    await mkdir(bin);
    const program = path.join(bin, 'server');
    await writeFile(program, '#!/bin/sh\n');
    await chmod(program, 0o755);
    expect(await resolveExecutable(program)).toBe(program);
    expect(await resolveExecutable('server', bin)).toBe(program);
  });

  it('rejects what cannot be launched safely', async () => {
    const root = await makeTempDir();
    const plain = path.join(root, 'data.txt');
    await writeFile(plain, 'x');
    await chmod(plain, 0o644);
    expect(await code(resolveExecutable(plain))).toBe('AI_MCP_ERROR');
    expect(await code(resolveExecutable(path.join(root, 'missing')))).toBe('AI_MCP_ERROR');
    expect(await code(resolveExecutable('./relative/server'))).toBe('AI_MCP_ERROR');
    expect(await code(resolveExecutable('not-a-real-command-xyz', root))).toBe('AI_MCP_ERROR');
    expect(await code(resolveExecutable(root))).toBe('AI_MCP_ERROR');
  });
});

describe('MCP server settings', () => {
  it('stores the token of a remote server securely and shows only a masked hint', async () => {
    const root = await makeTempDir();
    const { settings, directory } = createAiServices(root);
    const saved = await settings.saveMcpServer(remote({ authToken: 'token-ABCDEF-123456' }));
    expect(saved).toMatchObject({ transport: 'http', credentialHint: '••••3456', trusted: true });
    expect(await settings.mcpAuthToken(saved.id)).toBe('token-ABCDEF-123456');
    expect(await readFile(path.join(directory, 'settings.json'), 'utf8')).not.toContain('token-ABCDEF');
    const edited = await settings.saveMcpServer({ ...remote({ id: saved.id, name: 'Renamed' }), authToken: null });
    expect(edited.credentialHint).toBe('••••3456');
    await settings.removeMcpServer(saved.id);
    expect(await settings.mcpAuthToken(saved.id)).toBeNull();
    expect((await settings.get()).mcpServers).toEqual([]);
  });

  it('never stores a token for a local server', async () => {
    const { settings } = createAiServices(await makeTempDir());
    const saved = await settings.saveMcpServer(stdio({ authToken: 'ignored-token-1234' }));
    expect(saved.credentialHint).toBeNull();
    expect(await settings.mcpAuthToken(saved.id)).toBeNull();
  });

  it('refuses an unknown server id', async () => {
    const { settings } = createAiServices(await makeTempDir());
    expect(await code(settings.saveMcpServer(stdio({ id: 'missing' })))).toBe('AI_NOT_FOUND');
  });
});

describe('MCP connections', () => {
  async function connected(overrides: Partial<SaveMcpServerInput> = {}) {
    const server = fakeServer();
    const services = createAiServices(await makeTempDir(), { transports: server.transports, resolveCommand: async (command) => `/resolved/${command}` });
    const saved = await services.settings.saveMcpServer({ ...stdio(), ...overrides } as SaveMcpServerInput);
    return { ...services, server, saved };
  }

  it('connects, discovers the tools and launches the resolved program with the configured arguments', async () => {
    const { mcp, saved, server } = await connected();
    const status = await mcp.connect(saved.id);
    expect(status).toMatchObject({ id: saved.id, state: 'connected', error: null, commandLine: 'my-server --flag "two words"' });
    expect(status.tools.map((tool) => [tool.name, tool.serverName])).toEqual([['echo', 'Local tools'], ['explode', 'Local tools']]);
    expect(server.launched).toEqual([{ command: '/resolved/my-server', token: null, args: ['--flag', 'two words'] }]);
    expect((await mcp.tools()).map((tool) => tool.name)).toEqual(['echo', 'explode']);
    await mcp.closeAll();
  });

  it('does not ask the server for anything: the client offers no capabilities', async () => {
    const { mcp, saved, server } = await connected();
    await mcp.connect(saved.id);
    expect(server.clientCapabilities()).toEqual({});
    await mcp.closeAll();
  });

  it('never connects a server the user has not trusted, or that is disabled', async () => {
    const untrusted = await connected({ trusted: false });
    expect(await code(untrusted.mcp.connect(untrusted.saved.id))).toBe('AI_MCP_ERROR');
    const disabled = await connected({ enabled: false });
    expect(await code(disabled.mcp.connect(disabled.saved.id))).toBe('AI_MCP_ERROR');
    expect(untrusted.server.launched).toEqual([]);
    expect(disabled.server.launched).toEqual([]);
  });

  it('calls a tool and returns its text, noting content that is not text', async () => {
    const { mcp, saved, server } = await connected();
    await mcp.connect(saved.id);
    expect(await mcp.call(saved.id, 'echo', { text: 'hi' })).toEqual({ text: 'echo: hi\n[non-text content omitted]', isError: false });
    expect(server.calls).toEqual([{ text: 'hi' }]);
    expect(await mcp.call(saved.id, 'explode', {})).toEqual({ text: 'Something broke', isError: true });
    await mcp.closeAll();
  });

  it('validates the arguments before they reach the server, and only calls tools it discovered', async () => {
    const { mcp, saved, server } = await connected();
    await mcp.connect(saved.id);
    expect(await code(mcp.call(saved.id, 'echo', {}))).toBe('AI_MCP_ERROR');
    expect(await code(mcp.call(saved.id, 'echo', { text: 5 }))).toBe('AI_MCP_ERROR');
    expect(await code(mcp.call(saved.id, 'echo', { text: 'a', extra: true }))).toBe('AI_MCP_ERROR');
    expect(await code(mcp.call(saved.id, 'rm_rf', {}))).toBe('AI_MCP_ERROR');
    expect(await code(mcp.call('other-server', 'echo', { text: 'a' }))).toBe('AI_MCP_ERROR');
    expect(server.calls).toEqual([]);
    await mcp.closeAll();
  });

  it('disconnects, and stops offering its tools', async () => {
    const { mcp, saved } = await connected();
    await mcp.connect(saved.id);
    expect((await mcp.disconnect(saved.id))?.state).toBe('disconnected');
    expect(await mcp.tools()).toEqual([]);
    expect(await code(mcp.call(saved.id, 'echo', { text: 'a' }))).toBe('AI_MCP_ERROR');
    expect((await mcp.statuses())[0]).toMatchObject({ state: 'disconnected', tools: [] });
  });

  it('tests a connection and leaves it as it was', async () => {
    const { mcp, saved } = await connected();
    const tested = await mcp.test(saved.id);
    expect(tested).toMatchObject({ state: 'connected' });
    expect(tested.tools).toHaveLength(2);
    expect((await mcp.statuses())[0]?.state).toBe('disconnected');
    await mcp.connect(saved.id);
    await mcp.test(saved.id);
    expect((await mcp.statuses())[0]?.state).toBe('connected');
    await mcp.closeAll();
  });

  it('reports a connection failure without crashing, and without exposing the token', async () => {
    const token = 'remote-token-SECRET-7777';
    const server = fakeServer({ failToConnect: new Error(`401 Unauthorized for Bearer ${token}`) });
    const { settings, mcp } = createAiServices(await makeTempDir(), { transports: server.transports });
    const saved = await settings.saveMcpServer(remote({ authToken: token }));
    const status = await mcp.connect(saved.id);
    expect(status.state).toBe('error');
    expect(status.error).toContain('Could not connect');
    expect(status.error).not.toContain(token);
    expect(server.launched[0]?.token).toBe(token);
    expect((await mcp.tools())).toEqual([]);
  });

  it('reports a missing program', async () => {
    const server = fakeServer();
    const { settings, mcp } = createAiServices(await makeTempDir(), {
      transports: server.transports,
      resolveCommand: async () => {
        throw new AppError('AI_MCP_ERROR', 'The command "my-server" was not found on the PATH.');
      }
    });
    const saved = await settings.saveMcpServer(stdio());
    expect(await mcp.connect(saved.id)).toMatchObject({ state: 'error', error: expect.stringContaining('not found on the PATH') });
    expect(server.launched).toEqual([]);
  });

  it('does not offer the tools of a server that was disabled or untrusted after connecting', async () => {
    const { mcp, saved, settings } = await connected();
    await mcp.connect(saved.id);
    await settings.saveMcpServer({ ...stdio({ id: saved.id }), enabled: false });
    expect(await mcp.tools()).toEqual([]);
    await mcp.closeAll();
  });
});
