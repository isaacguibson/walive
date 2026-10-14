import { AppError } from '../../errors';
import type { AIProviderAdapter, ProviderConnection, TurnParams } from './adapter';
import type { ProviderDescriptor, TurnResult } from '@shared/ai/types';
import { GitHubCopilotRuntimeService, copilotError, normalizeCopilotModel, restrictedCopilotSession } from './copilotRuntime';
import type { GitHubCopilotAuthenticationService } from './copilotAuthentication';

export const COPILOT_PROVIDER_ID = 'github-copilot';

export class GitHubCopilotProviderAdapter implements AIProviderAdapter {
  readonly id = COPILOT_PROVIDER_ID;
  readonly descriptor: ProviderDescriptor = {
    kind: 'copilot', label: 'GitHub Copilot', needsApiKey: false, customEndpoint: 'none', defaultBaseUrl: null,
    available: true, unavailableReason: null,
    authHelp: 'Connect with an authorized GitHub account. A Copilot entitlement is required. Usage counts toward your Copilot plan.'
  };

  private auth?: GitHubCopilotAuthenticationService;
  constructor(readonly runtime: GitHubCopilotRuntimeService) {}
  setAuthentication(auth: GitHubCopilotAuthenticationService): void { this.auth = auth; }
  private token(connection: ProviderConnection): Promise<string | null> { return this.auth?.token(connection.providerId) ?? Promise.resolve(connection.apiKey); }

  async validate(connection: ProviderConnection, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const status = await this.runtime.connect(connection.providerId, await this.token(connection));
    if (status.state !== 'connected') throw new AppError('AI_AUTH_FAILED', status.message);
  }

  async listModels(connection: ProviderConnection, signal: AbortSignal) {
    signal.throwIfAborted();
    try {
      const client = await this.runtime.client(connection.providerId, await this.token(connection));
      return (await client.listModels()).map((model) => normalizeCopilotModel(connection.providerId, model));
    } catch (error) { throw copilotError(error); }
  }

  async runTurn(connection: ProviderConnection, params: TurnParams, onDelta: (text: string) => void, signal: AbortSignal): Promise<TurnResult> {
    if (params.tools.length > 0) throw new AppError('AI_UNSUPPORTED', 'Copilot tools require the SDK-managed agent workflow.');
    const client = await this.runtime.client(connection.providerId, await this.token(connection));
    const session = await client.createSession(restrictedCopilotSession(params.modelId, params.system, []));
    const cancel = () => { void session.abort(); };
    signal.addEventListener('abort', cancel, { once: true });
    const unsubscribe = session.on('assistant.message_delta', (event) => onDelta(event.data.deltaContent));
    try {
      signal.throwIfAborted();
      const message = await session.sendAndWait({ prompt: JSON.stringify(params.messages) });
      return { text: message?.data.content ?? '', toolCalls: [], stopReason: 'end' };
    } catch (error) { throw copilotError(error); }
    finally { signal.removeEventListener('abort', cancel); unsubscribe(); await session.disconnect(); }
  }
}