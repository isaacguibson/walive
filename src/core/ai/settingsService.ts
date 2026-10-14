import { randomUUID } from 'node:crypto';
import { AppError } from '../errors';
import { DEFAULT_APPROVAL, DEFAULT_LIMITS, EFFORT_LEVELS } from '@shared/ai/types';
import type {
  AIPreferences,
  AISettings,
  AgentLimits,
  ApprovalPolicy,
  EffortLevel,
  ManualModel,
  McpServerConfig,
  ModelSelection,
  ProviderConfig,
  SaveMcpServerInput,
  SaveProviderInput
} from '@shared/ai/types';
import { JsonFile, SerialQueue } from './jsonFile';
import { validateMcpServer } from './mcp/config';
import { normalizeBaseUrl, type AIProviderRegistry } from './providers/registry';
import type { ProviderConnection } from './providers/adapter';
import { SecureCredentialService, maskSecret } from './secureCredentialService';

const LIMIT_RANGES: Record<keyof AgentLimits, [number, number]> = {
  maxIterations: [1, 50],
  maxToolCalls: [1, 200],
  maxDurationSeconds: [10, 3600],
  maxToolInputBytes: [1_000, 200_000],
  maxToolOutputBytes: [1_000, 200_000],
  maxAttachmentBytes: [1_024, 20 * 1024 * 1024],
  maxContextChars: [10_000, 2_000_000]
};

const MODEL_ID = /^[^\s\u0000-\u001f]{1,120}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): AppError {
  return new AppError('AI_INVALID_CONFIG', message);
}

export function validateLimits(value: unknown): AgentLimits {
  if (!isRecord(value)) {
    throw invalid('The agent limits are invalid.');
  }
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(LIMIT_RANGES) as (keyof AgentLimits)[]) {
    const [min, max] = LIMIT_RANGES[key];
    const item = value[key];
    if (typeof item !== 'number' || !Number.isInteger(item) || item < min || item > max) {
      throw invalid(`Each agent limit must be a whole number within its allowed range (${key}: ${min}-${max}).`);
    }
    limits[key] = item;
  }
  return limits;
}

function validateApproval(value: unknown): ApprovalPolicy {
  if (!isRecord(value) || (value['modify'] !== 'auto' && value['modify'] !== 'ask') || (value['external'] !== 'auto' && value['external'] !== 'ask')) {
    throw invalid('The approval policy is invalid.');
  }
  return { modify: value['modify'], external: value['external'] };
}

function validateManualModels(value: unknown): ManualModel[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw invalid('The model list is invalid.');
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item) || typeof item['id'] !== 'string' || !MODEL_ID.test(item['id'])) {
      throw invalid('A model identifier is empty or contains spaces.');
    }
    if (seen.has(item['id'])) {
      throw invalid(`The model "${item['id']}" is listed twice.`);
    }
    seen.add(item['id']);
    const efforts = Array.isArray(item['efforts']) ? item['efforts'].filter((level): level is EffortLevel => EFFORT_LEVELS.includes(level as EffortLevel)) : [];
    const displayName = typeof item['displayName'] === 'string' && item['displayName'].trim() !== '' ? item['displayName'].trim().slice(0, 80) : item['id'];
    return { id: item['id'], displayName, image: item['image'] === true, tools: item['tools'] === true, efforts };
  });
}

function parseProvider(value: unknown): ProviderConfig | null {
  if (!isRecord(value) || typeof value['id'] !== 'string' || typeof value['kind'] !== 'string' || typeof value['name'] !== 'string') {
    return null;
  }
  try {
    return {
      id: value['id'],
      kind: value['kind'] as ProviderConfig['kind'],
      name: value['name'],
      baseUrl: typeof value['baseUrl'] === 'string' ? value['baseUrl'] : null,
      credentialHint: typeof value['credentialHint'] === 'string' ? value['credentialHint'] : null,
      manualModels: validateManualModels(value['manualModels'] ?? [])
    };
  } catch {
    return null;
  }
}

function parseMcpServer(value: unknown): McpServerConfig | null {
  try {
    return isRecord(value) && typeof value['id'] === 'string'
      ? { ...validateMcpServer({ ...(value as unknown as SaveMcpServerInput), id: value['id'], authToken: null }), id: value['id'], credentialHint: typeof value['credentialHint'] === 'string' ? value['credentialHint'] : null }
      : null;
  } catch {
    return null;
  }
}

function parseSettings(value: unknown): AISettings {
  const source = isRecord(value) ? value : {};
  const providers = (Array.isArray(source['providers']) ? source['providers'] : []).flatMap((item) => parseProvider(item) ?? []);
  const selection = isRecord(source['selection']) && typeof source['selection']['providerId'] === 'string' && typeof source['selection']['modelId'] === 'string'
    ? { providerId: source['selection']['providerId'], modelId: source['selection']['modelId'] }
    : null;
  const efforts: Record<string, EffortLevel> = {};
  if (isRecord(source['efforts'])) {
    for (const [key, level] of Object.entries(source['efforts'])) {
      if (EFFORT_LEVELS.includes(level as EffortLevel)) {
        efforts[key] = level as EffortLevel;
      }
    }
  }
  const limits = (() => {
    try {
      return validateLimits(source['limits']);
    } catch {
      return { ...DEFAULT_LIMITS };
    }
  })();
  const approval = (() => {
    try {
      return validateApproval(source['approval']);
    } catch {
      return { ...DEFAULT_APPROVAL };
    }
  })();
  const mcpServers = (Array.isArray(source['mcpServers']) ? source['mcpServers'] : []).flatMap((item) => parseMcpServer(item) ?? []);
  return { providers, selection: selection !== null && providers.some((p) => p.id === selection.providerId) ? selection : null, efforts, limits, approval, mcpServers };
}

const providerSecret = (id: string): string => `provider:${id}`;
const mcpSecret = (id: string): string => `mcp:${id}`;

/**
 * Non-secret AI settings: providers, preferences, limits, approval policy and MCP servers. Secrets
 * go to the credential service and are only referenced here by a masked hint.
 */
export class AISettingsService {
  private readonly file: JsonFile<AISettings>;
  private readonly queue = new SerialQueue();

  constructor(
    filePath: string,
    private readonly credentials: SecureCredentialService,
    private readonly providers: AIProviderRegistry
  ) {
    this.file = new JsonFile(filePath, parseSettings, 'AI settings');
  }

  get(): Promise<AISettings> {
    return this.file.read();
  }

  private mutate<T>(change: (settings: AISettings) => Promise<{ settings: AISettings; result: T }>): Promise<T> {
    return this.queue.run(async () => {
      const { settings, result } = await change(await this.file.read());
      await this.file.write(settings);
      return result;
    });
  }

  async saveProvider(input: SaveProviderInput): Promise<ProviderConfig> {
    const descriptor = this.providers.descriptors().find((candidate) => candidate.kind === input.kind);
    if (descriptor === undefined || !descriptor.available) {
      throw new AppError('AI_UNSUPPORTED', descriptor?.unavailableReason ?? 'This provider is not available.');
    }
    const name = input.name.trim();
    if (name === '' || name.length > 60) {
      throw invalid('Enter a connection name of up to 60 characters.');
    }
    const blankUrl = input.baseUrl === null || input.baseUrl.trim() === '';
    if (blankUrl && descriptor.customEndpoint === 'required') {
      throw invalid('This provider needs an endpoint URL.');
    }
    const baseUrl = blankUrl || descriptor.customEndpoint === 'none' ? null : normalizeBaseUrl(input.baseUrl ?? '');
    const manualModels = validateManualModels(input.manualModels);
    const apiKey = input.apiKey?.trim() === '' ? null : (input.apiKey?.trim() ?? null);

    return this.mutate(async (settings) => {
      const existing = input.id === null ? undefined : settings.providers.find((provider) => provider.id === input.id);
      if (input.id !== null && existing === undefined) {
        throw new AppError('AI_NOT_FOUND', 'This connection no longer exists.');
      }
      const id = existing?.id ?? randomUUID();
      if (apiKey !== null) {
        await this.credentials.set(providerSecret(id), apiKey);
      }
      const provider: ProviderConfig = {
        id,
        kind: input.kind,
        name,
        baseUrl,
        credentialHint: apiKey === null ? (existing?.credentialHint ?? null) : maskSecret(apiKey),
        manualModels
      };
      const providers = existing === undefined ? [...settings.providers, provider] : settings.providers.map((item) => (item.id === id ? provider : item));
      return { settings: { ...settings, providers }, result: provider };
    });
  }

  /** Forgets the stored key but keeps the connection. */
  disconnectProvider(id: string): Promise<void> {
    return this.mutate(async (settings) => {
      await this.credentials.delete(providerSecret(id));
      const providers = settings.providers.map((provider) => (provider.id === id ? { ...provider, credentialHint: null } : provider));
      return { settings: { ...settings, providers }, result: undefined };
    });
  }

  removeProvider(id: string): Promise<void> {
    return this.mutate(async (settings) => {
      await this.credentials.delete(providerSecret(id));
      const selection = settings.selection?.providerId === id ? null : settings.selection;
      const efforts = Object.fromEntries(Object.entries(settings.efforts).filter(([key]) => !key.startsWith(`${id}/`)));
      return { settings: { ...settings, providers: settings.providers.filter((provider) => provider.id !== id), selection, efforts }, result: undefined };
    });
  }

  /** Everything an adapter needs to talk to a saved provider, including its key. Main process only. */
  async connection(id: string): Promise<{ config: ProviderConfig; connection: ProviderConnection }> {
    const config = (await this.get()).providers.find((provider) => provider.id === id);
    if (config === undefined) {
      throw new AppError('AI_NOT_FOUND', 'This connection no longer exists.');
    }
    return { config, connection: await this.connectionFor(config, null) };
  }

  /** Same as `connection`, for a configuration that is not saved yet; `apiKey: null` falls back to the stored key. */
  async connectionFor(config: Pick<ProviderConfig, 'id' | 'kind' | 'baseUrl' | 'manualModels'>, apiKey: string | null): Promise<ProviderConnection> {
    const descriptor = this.providers.resolve(config.kind).descriptor;
    const baseUrl = config.baseUrl ?? descriptor.defaultBaseUrl;
    if (baseUrl === null) {
      throw invalid('This provider needs an endpoint URL.');
    }
    return { providerId: config.id, baseUrl, apiKey: apiKey ?? (await this.credentials.get(providerSecret(config.id))), manualModels: config.manualModels };
  }

  updatePreferences(preferences: AIPreferences): Promise<AISettings> {
    return this.mutate(async (settings) => {
      const next = { ...settings };
      if (preferences.selection !== undefined) {
        const selection: ModelSelection | null = preferences.selection;
        if (selection !== null && !settings.providers.some((provider) => provider.id === selection.providerId)) {
          throw invalid('The selected connection no longer exists.');
        }
        next.selection = selection;
      }
      if (preferences.efforts !== undefined) {
        next.efforts = { ...settings.efforts, ...Object.fromEntries(Object.entries(preferences.efforts).filter(([, level]) => EFFORT_LEVELS.includes(level))) };
      }
      if (preferences.limits !== undefined) {
        next.limits = validateLimits(preferences.limits);
      }
      if (preferences.approval !== undefined) {
        next.approval = validateApproval(preferences.approval);
      }
      return { settings: next, result: next };
    });
  }

  async saveMcpServer(input: SaveMcpServerInput): Promise<McpServerConfig> {
    const validated = validateMcpServer(input);
    const authToken = input.authToken?.trim() === '' ? null : (input.authToken?.trim() ?? null);
    return this.mutate(async (settings) => {
      const existing = input.id === null ? undefined : settings.mcpServers.find((server) => server.id === input.id);
      if (input.id !== null && existing === undefined) {
        throw new AppError('AI_NOT_FOUND', 'This server no longer exists.');
      }
      const id = existing?.id ?? randomUUID();
      if (authToken !== null && validated.transport === 'http') {
        await this.credentials.set(mcpSecret(id), authToken);
      }
      const server: McpServerConfig = {
        ...validated,
        id,
        credentialHint: validated.transport !== 'http' ? null : authToken === null ? (existing?.credentialHint ?? null) : maskSecret(authToken)
      };
      const mcpServers = existing === undefined ? [...settings.mcpServers, server] : settings.mcpServers.map((item) => (item.id === id ? server : item));
      return { settings: { ...settings, mcpServers }, result: server };
    });
  }

  removeMcpServer(id: string): Promise<void> {
    return this.mutate(async (settings) => {
      await this.credentials.delete(mcpSecret(id));
      return { settings: { ...settings, mcpServers: settings.mcpServers.filter((server) => server.id !== id) }, result: undefined };
    });
  }

  mcpAuthToken(id: string): Promise<string | null> {
    return this.credentials.get(mcpSecret(id));
  }
}
