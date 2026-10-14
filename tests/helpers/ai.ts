import path from 'node:path';
import { AIConnectionService } from '@core/ai/connectionService';
import { ConversationRepository } from '@core/ai/conversationRepository';
import { JsonFile } from '@core/ai/jsonFile';
import { MCPClientService, type McpTransportFactory } from '@core/ai/mcp/mcpClientService';
import { AIModelRegistry, parseModelCache } from '@core/ai/modelRegistry';
import type { FetchLike } from '@core/ai/providers/adapter';
import { createDefaultProviderRegistry } from '@core/ai/providers/registry';
import { SecureCredentialService, type SecretCipher } from '@core/ai/secureCredentialService';
import { AISettingsService } from '@core/ai/settingsService';
import { AITurnService } from '@core/ai/turnService';
import { silentLogger, type Logger } from '@core/logger';
import type { TurnEvent } from '@shared/ai/types';

/** Reversible stand-in for the operating system keychain; the stored form never contains the plain text. */
export class FakeCipher implements SecretCipher {
  available = true;

  isAvailable(): boolean {
    return this.available;
  }

  encrypt(plainText: string): string {
    return `enc:${Buffer.from([...plainText].reverse().join('')).toString('base64')}`;
  }

  decrypt(encrypted: string): string {
    return [...Buffer.from(encrypted.slice(4), 'base64').toString()].reverse().join('');
  }
}

export interface AiServiceOptions {
  fetch?: FetchLike;
  cipher?: SecretCipher;
  transports?: McpTransportFactory;
  resolveCommand?: (command: string) => Promise<string>;
  logger?: Logger;
}

const unreachable: FetchLike = async () => {
  throw new Error('No network in this test');
};

/** The AI services wired like the application, over a temporary directory and fakes. */
export function createAiServices(root: string, options: AiServiceOptions = {}) {
  const directory = path.join(root, 'ai');
  const logger = options.logger ?? silentLogger;
  const events: TurnEvent[] = [];
  const credentials = new SecureCredentialService(path.join(directory, 'credentials.json'), options.cipher ?? new FakeCipher());
  const providers = createDefaultProviderRegistry(options.fetch ?? unreachable);
  const settings = new AISettingsService(path.join(directory, 'settings.json'), credentials, providers);
  const models = new AIModelRegistry(new JsonFile(path.join(directory, 'models.json'), parseModelCache, 'The model list'));
  const connections = new AIConnectionService(settings, providers, models, logger);
  const turns = new AITurnService(settings, providers, (event) => events.push(event), logger);
  const conversations = new ConversationRepository(path.join(directory, 'conversations'));
  const mcp = new MCPClientService(settings, logger, options.transports, options.resolveCommand);
  return { directory, events, credentials, providers, settings, models, connections, turns, conversations, mcp };
}
