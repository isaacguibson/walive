import { AppError } from '../errors';
import { describeError, type Logger } from '../logger';
import type { ModelInfo, SaveProviderInput } from '@shared/ai/types';
import type { AIModelRegistry } from './modelRegistry';
import { normalizeBaseUrl, type AIProviderRegistry } from './providers/registry';
import type { AISettingsService } from './settingsService';

const REQUEST_TIMEOUT_MS = 20_000;

function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

/** Validates provider connectivity and keeps the model registry up to date. */
export class AIConnectionService {
  constructor(
    private readonly settings: AISettingsService,
    private readonly providers: AIProviderRegistry,
    private readonly models: AIModelRegistry,
    private readonly logger: Logger
  ) {}

  /** Checks a configuration without saving it. Resolves to the number of models the provider lists. */
  async validate(input: SaveProviderInput, signal?: AbortSignal): Promise<{ modelCount: number }> {
    const adapter = this.providers.resolve(input.kind);
    const baseUrl = input.baseUrl === null || input.baseUrl.trim() === '' ? null : normalizeBaseUrl(input.baseUrl);
    const apiKey = input.apiKey?.trim() === '' ? null : (input.apiKey?.trim() ?? null);
    const connection = await this.settings.connectionFor({ id: input.id ?? 'draft', kind: input.kind, baseUrl, manualModels: input.manualModels }, apiKey);
    if (adapter.descriptor.needsApiKey && connection.apiKey === null) {
      throw new AppError('AI_NOT_CONFIGURED', 'Enter an API key for this provider.');
    }
    const guarded = withTimeout(signal);
    await adapter.validate(connection, guarded);
    const models = await adapter.listModels(connection, guarded);
    return { modelCount: models.length + input.manualModels.length };
  }

  /** Asks the provider for its models and updates the registry. Failures keep the previous list. */
  async refreshModels(providerId: string, signal?: AbortSignal): Promise<ModelInfo[]> {
    const { config, connection } = await this.settings.connection(providerId);
    const adapter = this.providers.resolve(config.kind);
    try {
      await this.models.store(providerId, await adapter.listModels(connection, withTimeout(signal)));
    } catch (error) {
      this.logger.warn('Model discovery failed', { provider: config.kind, ...describeError(error) });
      throw error;
    }
    return this.modelsOf(providerId);
  }

  async modelsOf(providerId: string): Promise<ModelInfo[]> {
    const config = (await this.settings.get()).providers.find((provider) => provider.id === providerId);
    if (config === undefined) {
      return [];
    }
    const descriptor = this.providers.descriptors().find((candidate) => candidate.kind === config.kind);
    const usable = descriptor?.needsApiKey !== true || config.credentialHint !== null;
    return this.models.list(providerId, config.manualModels, usable);
  }

  async listModels(): Promise<ModelInfo[]> {
    const { providers } = await this.settings.get();
    return (await Promise.all(providers.map((provider) => this.modelsOf(provider.id)))).flat();
  }
}
