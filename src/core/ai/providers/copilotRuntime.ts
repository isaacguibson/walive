import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CopilotClient, type CopilotClientOptions, type ModelInfo as SdkModel, type SessionConfig } from '@github/copilot-sdk';
import { AppError } from '../../errors';
import type { CopilotStatus } from '@shared/ai/copilot';
import type { EffortLevel, ModelInfo } from '@shared/ai/types';

/** The only variables of this process the runtime receives; the Windows ones are what it needs to find the user's profile and credentials. */
const RUNTIME_ENV_KEYS = [
  'HOME', 'PATH', 'TMPDIR', 'SYSTEMROOT', 'LANG',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMDATA', 'WINDIR', 'COMSPEC', 'PATHEXT'
] as const;

export type CopilotClientFactory = (options: CopilotClientOptions) => CopilotClient;

export function copilotError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : '';
  if (/subscription|entitlement|copilot.*(access|plan)|403/.test(message.toLowerCase())) {
    return new AppError('AI_AUTH_FAILED', 'This account has no Copilot access, or your organization blocks it. Check your Copilot plan and organization policy.');
  }
  if (/auth|401|token|login/i.test(message)) return new AppError('AI_AUTH_FAILED', 'GitHub authentication is required. Connect GitHub Copilot again.');
  if (/429|quota|rate.limit/i.test(message)) return new AppError('AI_RATE_LIMITED', 'The Copilot usage limit was reached. Check your plan or try again later.');
  if (/model.*(not|unavailable|unsupported)/i.test(message)) return new AppError('AI_NOT_FOUND', 'This Copilot model is unavailable. Refresh the model list and select another model.');
  if (/network|fetch|connect|ECONN|timeout/i.test(message)) return new AppError('AI_NETWORK', 'Copilot could not be reached. Check your connection and try again.');
  return new AppError('AI_PROVIDER_ERROR', 'The Copilot runtime failed. Reconnect the provider. Check that the SDK runtime for this platform is installed and executable.');
}

export function normalizeCopilotModel(providerId: string, model: SdkModel): ModelInfo {
  const efforts = model.capabilities.supports.reasoningEffort ? (model.supportedReasoningEfforts ?? []).filter((effort): effort is EffortLevel => ['low', 'medium', 'high', 'max'].includes(effort)) : [];
  return {
    providerId, id: model.id, displayName: model.name, source: 'provider',
    available: model.policy === undefined || model.policy.state === 'enabled',
    capabilities: { image: model.capabilities.supports.vision ? 'yes' : 'no', tools: 'yes', streaming: 'yes', efforts, contextWindow: model.capabilities.limits.max_context_window_tokens ?? null }
  };
}

export function restrictedCopilotSession(model: string, system: string, tools: SessionConfig['tools']): SessionConfig {
  return {
    model, tools, clientName: 'Animation Studio', streaming: true,
    availableTools: (tools ?? []).map((tool) => `custom:${tool.name}`),
    excludedTools: ['builtin:*', 'mcp:*'],
    enableConfigDiscovery: false, enableSkills: false, enableFileHooks: false,
    enableHostGitOperations: false, enableSessionStore: false, enableOnDemandInstructionDiscovery: false,
    enableSessionTelemetry: false, memory: { enabled: false }, largeOutput: { enabled: false },
    infiniteSessions: { enabled: false }, toolSearch: { enabled: false },
    systemMessage: { mode: 'append', content: system },
    onPermissionRequest: () => ({ kind: 'reject', feedback: 'Only Animation Studio custom tools are allowed.' })
  };
}

export class GitHubCopilotRuntimeService {
  private readonly clients = new Map<string, Promise<CopilotClient>>();
  private readonly tokens = new Map<string, string | null>();
  private readonly statuses = new Map<string, CopilotStatus>();

  constructor(private readonly directory: string, private readonly factory: CopilotClientFactory = (options) => new CopilotClient(options)) {}

  status(id: string): CopilotStatus {
    return this.statuses.get(id) ?? { state: 'not-connected', login: null, message: 'Connect to use GitHub Copilot.' };
  }

  async client(id: string, token: string | null): Promise<CopilotClient> {
    if (this.clients.has(id) && this.tokens.get(id) !== token) await this.stop(id);
    let pending = this.clients.get(id);
    if (pending !== undefined) {
      try { await (await pending).ping(); }
      catch { await this.stop(id); pending = undefined; }
    }
    if (pending === undefined) {
      pending = (async () => {
        await fs.mkdir(this.directory, { recursive: true });
        const env: Record<string, string | undefined> = {};
        for (const key of RUNTIME_ENV_KEYS) env[key] = process.env[key];
        const client = this.factory({ mode: 'empty', workingDirectory: this.directory, baseDirectory: path.join(this.directory, 'state'), logLevel: 'none', env, useLoggedInUser: token === null, ...(token === null ? {} : { gitHubToken: token }), enableRemoteSessions: false });
        try {
          await client.start();
          return client;
        } catch (error) {
          await client.forceStop().catch(() => undefined);
          throw copilotError(error);
        }
      })();
      this.clients.set(id, pending);
      this.tokens.set(id, token);
      pending.catch(() => { if (this.clients.get(id) === pending) this.clients.delete(id); });
    }
    return pending;
  }

  async connect(id: string, token: string | null): Promise<CopilotStatus> {
    this.statuses.set(id, { state: 'connecting', login: null, message: 'Connecting to GitHub Copilot.' });
    try {
      const client = await this.client(id, token);
      const auth = await client.getAuthStatus();
      if (!auth.isAuthenticated) {
        const status: CopilotStatus = { state: 'authentication-required', login: null, message: 'No GitHub Copilot login was found. Use "Sign in with GitHub", or run "copilot login" with the official GitHub Copilot CLI and connect again.' };
        this.statuses.set(id, status);
        return status;
      }
      await client.listModels();
      const status: CopilotStatus = { state: 'connected', login: auth.login ?? null, message: 'Connected. Copilot plan limits and organization policies apply.' };
      this.statuses.set(id, status);
      return status;
    } catch (error) {
      const failure = copilotError(error);
      const status: CopilotStatus = { state: failure.code === 'AI_AUTH_FAILED' ? (/no Copilot access/.test(failure.message) ? 'missing-entitlement' : 'authentication-required') : 'error', login: null, message: failure.message };
      this.statuses.set(id, status);
      await this.stop(id);
      return status;
    }
  }

  async stop(id: string): Promise<void> {
    const pending = this.clients.get(id);
    this.clients.delete(id);
    this.tokens.delete(id);
    const client = await pending?.catch(() => undefined);
    if (client !== undefined) {
      try { await client.stop(); } catch { await client.forceStop().catch(() => undefined); }
    }
  }

  async disconnect(id: string): Promise<void> {
    await this.stop(id);
    this.statuses.set(id, { state: 'disconnected', login: null, message: 'Disconnected from Animation Studio. Other GitHub applications remain signed in.' });
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.keys()].map((id) => this.stop(id)));
  }
}