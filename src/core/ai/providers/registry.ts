import { AppError } from '../../errors';
import type { ProviderDescriptor, ProviderKind } from '@shared/ai/types';
import type { AIProviderAdapter, FetchLike } from './adapter';
import { AnthropicAdapter } from './anthropicAdapter';
import { OpenAiAdapter } from './openAiAdapter';

const COPILOT_DESCRIPTOR: ProviderDescriptor = {
  kind: 'copilot',
  label: 'GitHub Copilot',
  authHelp: 'GitHub Copilot is not available yet.',
  needsApiKey: false,
  customEndpoint: 'none',
  defaultBaseUrl: null,
  available: false,
  unavailableReason:
    'GitHub does not offer an officially supported way for third-party apps to use a Copilot subscription. It will be added when one exists. Meanwhile, use an OpenAI or Anthropic API key.'
};

/** Registers and resolves provider adapters by kind. */
export class AIProviderRegistry {
  private readonly adapters = new Map<ProviderKind, AIProviderAdapter>();
  private readonly unavailable: ProviderDescriptor[] = [];

  register(adapter: AIProviderAdapter): void {
    this.adapters.set(adapter.descriptor.kind, adapter);
  }

  /** Lists a provider the application knows about but cannot offer yet, with the reason. */
  registerUnavailable(descriptor: ProviderDescriptor): void {
    this.unavailable.push(descriptor);
  }

  resolve(kind: ProviderKind): AIProviderAdapter {
    const adapter = this.adapters.get(kind);
    if (adapter === undefined) {
      throw new AppError('AI_UNSUPPORTED', 'This provider is not available.');
    }
    return adapter;
  }

  descriptors(): ProviderDescriptor[] {
    return [...[...this.adapters.values()].map((adapter) => adapter.descriptor), ...this.unavailable];
  }
}

export function createDefaultProviderRegistry(fetchImpl: FetchLike): AIProviderRegistry {
  const registry = new AIProviderRegistry();
  registry.register(new OpenAiAdapter(fetchImpl, true));
  registry.register(new AnthropicAdapter(fetchImpl));
  registry.register(new OpenAiAdapter(fetchImpl, false));
  registry.registerUnavailable(COPILOT_DESCRIPTOR);
  return registry;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Normalizes a custom endpoint. Keys are only ever sent over HTTPS, or to this machine, and an
 * endpoint cannot carry credentials, a query or a fragment.
 */
export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AppError('AI_INVALID_CONFIG', 'The endpoint is not a valid URL.');
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new AppError('AI_INVALID_CONFIG', 'The endpoint must use https (http is only allowed for localhost).');
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new AppError('AI_INVALID_CONFIG', 'The endpoint cannot include credentials, a query or a fragment.');
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}
