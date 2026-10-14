import { AppError } from '../errors';
import { describeError, type Logger } from '../logger';
import type { TurnEvent, TurnRequest, TurnResult } from '@shared/ai/types';
import type { AIProviderRegistry } from './providers/registry';
import type { AISettingsService } from './settingsService';

/** Runs single model requests for the agent and streams their text to the renderer. */
export class AITurnService {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly settings: AISettingsService,
    private readonly providers: AIProviderRegistry,
    private readonly publish: (event: TurnEvent) => void,
    private readonly logger: Logger
  ) {}

  async run(request: TurnRequest): Promise<TurnResult> {
    if (this.active.has(request.requestId)) {
      throw new AppError('INVALID_REQUEST', 'The request could not be processed.');
    }
    const { config, connection } = await this.settings.connection(request.providerId);
    const adapter = this.providers.resolve(config.kind);
    if (adapter.descriptor.needsApiKey && connection.apiKey === null) {
      throw new AppError('AI_NOT_CONFIGURED', `Connection "${config.name}" has no API key. Add one in the AI settings.`);
    }

    const controller = new AbortController();
    this.active.set(request.requestId, controller);
    try {
      return await adapter.runTurn(
        connection,
        { modelId: request.modelId, effort: request.effort, system: request.system, messages: request.messages, tools: request.tools },
        (delta) => this.publish({ requestId: request.requestId, delta }),
        controller.signal
      );
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AppError('AI_CANCELLED', 'The request was cancelled.');
      }
      if (!(error instanceof AppError)) {
        this.logger.error('Model request failed', { provider: config.kind, model: request.modelId, ...describeError(error) });
        throw new AppError('AI_PROVIDER_ERROR', 'The model request failed unexpectedly.', { cause: error });
      }
      this.logger.warn('Model request failed', { provider: config.kind, model: request.modelId, code: error.code });
      throw error;
    } finally {
      this.active.delete(request.requestId);
    }
  }

  cancel(requestId: string): void {
    this.active.get(requestId)?.abort();
  }
}
