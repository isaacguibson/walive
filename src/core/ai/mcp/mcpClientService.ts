import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { AppError } from '../../errors';
import { describeError, type Logger } from '../../logger';
import { validateSchema } from '@shared/ai/schema';
import type { McpCallResult, McpServerConfig, McpServerStatus, McpToolInfo } from '@shared/ai/types';
import { redact } from '../providers/http';
import type { AISettingsService } from '../settingsService';
import { formatCommandLine, resolveExecutable } from './config';

const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 60_000;
const MAX_TOOLS = 100;
const MAX_RESULT_CHARS = 100_000;

/** Creates the transport for a server; replaced by an in-memory one in tests. */
export type McpTransportFactory = (config: McpServerConfig, executable: string | null, authToken: string | null) => Transport;

export const createTransport: McpTransportFactory = (config, executable, authToken) => {
  if (config.transport === 'stdio') {
    // The SDK starts the child with a minimal environment, so application secrets are not inherited.
    return new StdioClientTransport({ command: executable ?? config.command, args: config.args, stderr: 'ignore' });
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: authToken === null ? {} : { Authorization: `Bearer ${authToken}` } }
  });
};

interface Session {
  client: Client;
  tools: McpToolInfo[];
}

function mcpError(message: string): AppError {
  return new AppError('AI_MCP_ERROR', message);
}

/** Connections to the configured MCP servers. Their tools and output are treated as untrusted. */
export class MCPClientService {
  private readonly sessions = new Map<string, Session>();
  private readonly states = new Map<string, { state: McpServerStatus['state']; error: string | null }>();

  constructor(
    private readonly settings: AISettingsService,
    private readonly logger: Logger,
    private readonly transports: McpTransportFactory = createTransport,
    private readonly resolveCommand: (command: string) => Promise<string> = resolveExecutable
  ) {}

  private statusOf(server: McpServerConfig): McpServerStatus {
    const known = this.states.get(server.id) ?? { state: 'disconnected' as const, error: null };
    return {
      id: server.id,
      state: known.state,
      error: known.error,
      commandLine: server.transport === 'stdio' ? formatCommandLine(server.command, server.args) : null,
      tools: this.sessions.get(server.id)?.tools ?? []
    };
  }

  async statuses(): Promise<McpServerStatus[]> {
    return (await this.settings.get()).mcpServers.map((server) => this.statusOf(server));
  }

  private async server(id: string): Promise<McpServerConfig> {
    const server = (await this.settings.get()).mcpServers.find((candidate) => candidate.id === id);
    if (server === undefined) {
      throw new AppError('AI_NOT_FOUND', 'This server no longer exists.');
    }
    return server;
  }

  async connect(id: string): Promise<McpServerStatus> {
    const server = await this.server(id);
    if (!server.trusted) {
      throw mcpError('Trust this server in its settings before connecting. A trusted server can run code or receive data from your agent.');
    }
    if (!server.enabled) {
      throw mcpError('Enable this server before connecting.');
    }
    await this.disconnect(id);
    this.states.set(id, { state: 'connecting', error: null });
    const token = server.transport === 'http' ? await this.settings.mcpAuthToken(id) : null;
    const client = new Client({ name: 'animation-studio', version: '0.1.0' }, { capabilities: {} });
    try {
      const executable = server.transport === 'stdio' ? await this.resolveCommand(server.command) : null;
      const signal = AbortSignal.timeout(CONNECT_TIMEOUT_MS);
      await client.connect(this.transports(server, executable, token), { signal });
      const listed = await client.listTools(undefined, { signal });
      const tools = listed.tools.slice(0, MAX_TOOLS).map(
        (tool): McpToolInfo => ({
          serverId: id,
          serverName: server.name,
          name: tool.name,
          description: (tool.description ?? '').slice(0, 1_000),
          inputSchema: tool.inputSchema as Record<string, unknown>
        })
      );
      client.onclose = () => {
        if (this.sessions.get(id)?.client === client) {
          this.sessions.delete(id);
          this.states.set(id, { state: 'disconnected', error: null });
        }
      };
      this.sessions.set(id, { client, tools });
      this.states.set(id, { state: 'connected', error: null });
    } catch (error) {
      await client.close().catch(() => undefined);
      const message = error instanceof AppError ? error.message : redact(error instanceof Error ? error.message : 'Unknown error', [token]).slice(0, 300);
      this.logger.warn('MCP connection failed', { server: server.name, ...describeError(error) });
      this.states.set(id, { state: 'error', error: `Could not connect: ${message}` });
    }
    return this.statusOf(server);
  }

  async disconnect(id: string): Promise<McpServerStatus | null> {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    this.states.set(id, { state: 'disconnected', error: null });
    await session?.client.close().catch(() => undefined);
    const server = (await this.settings.get()).mcpServers.find((candidate) => candidate.id === id);
    return server === undefined ? null : this.statusOf(server);
  }

  /** Connects, reads the tools and, if the server was not connected before, disconnects again. */
  async test(id: string): Promise<McpServerStatus> {
    const wasConnected = this.sessions.has(id);
    const status = await this.connect(id);
    if (!wasConnected && status.state === 'connected') {
      const tested = { ...status };
      await this.disconnect(id);
      return tested;
    }
    return status;
  }

  /** Tools of the connected servers that may be offered to the agent. */
  async tools(): Promise<McpToolInfo[]> {
    const servers = (await this.settings.get()).mcpServers.filter((server) => server.enabled && server.trusted);
    return servers.flatMap((server) => this.sessions.get(server.id)?.tools ?? []);
  }

  async call(serverId: string, toolName: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    const session = this.sessions.get(serverId);
    const tool = session?.tools.find((candidate) => candidate.name === toolName);
    if (session === undefined || tool === undefined) {
      throw mcpError('This MCP tool is not available. Connect the server again.');
    }
    const issues = validateSchema(tool.inputSchema, input);
    if (issues.length > 0) {
      throw mcpError(`Invalid arguments for the tool: ${issues.join('; ')}.`);
    }
    try {
      const result = await session.client.callTool({ name: toolName, arguments: input }, undefined, {
        ...(signal === undefined ? {} : { signal }),
        timeout: CALL_TIMEOUT_MS
      });
      const content = Array.isArray(result['content']) ? (result['content'] as { type?: string; text?: string }[]) : [];
      const text = content.map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : '[non-text content omitted]')).join('\n');
      return { text: text.slice(0, MAX_RESULT_CHARS), isError: result['isError'] === true };
    } catch (error) {
      if (signal?.aborted === true) {
        throw new AppError('AI_CANCELLED', 'The tool call was cancelled.');
      }
      this.logger.warn('MCP tool call failed', { server: tool.serverName, tool: toolName, ...describeError(error) });
      throw mcpError('The MCP server could not complete the tool call.');
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.disconnect(id)));
  }
}
