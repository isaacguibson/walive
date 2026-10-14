import { readAttachments } from '@core/ai/attachments';
import type { AIConnectionService } from '@core/ai/connectionService';
import type { ConversationRepository } from '@core/ai/conversationRepository';
import type { MCPClientService } from '@core/ai/mcp/mcpClientService';
import type { AIModelRegistry } from '@core/ai/modelRegistry';
import type { AIProviderRegistry } from '@core/ai/providers/registry';
import type { AISettingsService } from '@core/ai/settingsService';
import type { AITurnService } from '@core/ai/turnService';
import type { Logger } from '@core/logger';
import { AppError } from '@core/errors';
import type { GitHubCopilotRuntimeService } from '@core/ai/providers/copilotRuntime';
import type { GitHubCopilotAuthenticationService } from '@core/ai/providers/copilotAuthentication';
import type { GitHubCopilotSessionService } from '@core/ai/providers/copilotSessionService';
import type { CopilotEvent } from '@shared/ai/copilot';
import { parseChatMessages, parseConversation, parseEffort, parseToolSpecs } from '@shared/ai/validation';
import type { AIPreferences, AIState, AgentLimits, ApprovalPolicy, EffortLevel, ManualModel, ProviderKind, SaveMcpServerInput, SaveProviderInput, TurnRequest } from '@shared/ai/types';
import { IPC_CHANNELS } from '@shared/ipc/channels';
import { asRecord, createRegistrar, invalidRequest, requireString, type IpcMainLike } from './ipcSupport';

/** Native file selection for message attachments, implemented in the main process. */
export interface AttachmentFilePicker {
  /** Resolves to the chosen absolute paths, or an empty list when the dialog is cancelled. */
  pickFiles(): Promise<string[]>;
}

export interface AiIpcDependencies {
  copilot?: { runtime: GitHubCopilotRuntimeService; auth: GitHubCopilotAuthenticationService; sessions: GitHubCopilotSessionService; publish(event: CopilotEvent): void };
  ipc: IpcMainLike;
  settings: AISettingsService;
  providers: AIProviderRegistry;
  models: AIModelRegistry;
  connections: AIConnectionService;
  turns: AITurnService;
  conversations: ConversationRepository;
  mcp: MCPClientService;
  attachmentPicker: AttachmentFilePicker;
  logger: Logger;
}

const MAX_SYSTEM_CHARS = 200_000;
const KINDS: readonly ProviderKind[] = ['openai', 'anthropic', 'openai-compatible', 'copilot'];

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return requireString(value);
}

function boundedString(value: unknown, max: number): string {
  const text = requireString(value);
  if (text.length > max) {
    throw invalidRequest();
  }
  return text;
}

function parseProviderInput(payload: unknown): SaveProviderInput {
  const request = asRecord(payload);
  const kind = KINDS.find((candidate) => candidate === request['kind']);
  if (kind === undefined || !Array.isArray(request['manualModels'])) {
    throw invalidRequest();
  }
  return {
    id: nullableString(request['id']),
    kind,
    name: boundedString(request['name'], 200),
    baseUrl: nullableString(request['baseUrl']),
    apiKey: nullableString(request['apiKey']),
    manualModels: request['manualModels'] as ManualModel[],
    ...(request['oauthClientId'] === undefined ? {} : { oauthClientId: boundedString(request['oauthClientId'], 100) })
  };
}

function parsePreferences(payload: unknown): AIPreferences {
  const request = asRecord(payload);
  const preferences: AIPreferences = {};
  if (request['selection'] !== undefined) {
    if (request['selection'] === null) {
      preferences.selection = null;
    } else {
      const selection = asRecord(request['selection']);
      preferences.selection = { providerId: requireString(selection['providerId']), modelId: requireString(selection['modelId']) };
    }
  }
  if (request['efforts'] !== undefined) {
    preferences.efforts = asRecord(request['efforts']) as Record<string, EffortLevel>;
  }
  if (request['limits'] !== undefined) {
    preferences.limits = request['limits'] as AgentLimits;
  }
  if (request['approval'] !== undefined) {
    preferences.approval = request['approval'] as ApprovalPolicy;
  }
  return preferences;
}

function parseMcpInput(payload: unknown): SaveMcpServerInput {
  const request = asRecord(payload);
  const common = {
    id: nullableString(request['id']),
    name: boundedString(request['name'], 200),
    enabled: request['enabled'] === true,
    trusted: request['trusted'] === true,
    authToken: nullableString(request['authToken'])
  };
  if (request['transport'] === 'http') {
    return { ...common, transport: 'http', url: boundedString(request['url'], 2_000) };
  }
  if (request['transport'] === 'stdio' && Array.isArray(request['args']) && request['args'].every((arg) => typeof arg === 'string')) {
    return { ...common, transport: 'stdio', command: boundedString(request['command'], 1_000), args: request['args'] as string[] };
  }
  throw invalidRequest();
}

function parseTurn(payload: unknown): TurnRequest {
  const request = asRecord(payload);
  const messages = parseChatMessages(request['messages']);
  const tools = parseToolSpecs(request['tools']);
  if (messages === null || tools === null) {
    throw invalidRequest();
  }
  return {
    requestId: boundedString(request['requestId'], 100),
    providerId: boundedString(request['providerId'], 100),
    modelId: boundedString(request['modelId'], 200),
    effort: request['effort'] === null ? null : parseEffort(request['effort']),
    system: boundedString(request['system'], MAX_SYSTEM_CHARS),
    messages,
    tools
  };
}

/** Registers the AI channels. Credentials, provider traffic and MCP processes stay in this process. */
export function registerAiIpcHandlers(deps: AiIpcDependencies): void {
  const { settings, providers, models, connections, turns, conversations, mcp, attachmentPicker } = deps;
  const register = createRegistrar(deps.ipc, deps.logger);

  async function state(): Promise<AIState> {
    return { settings: await settings.get(), descriptors: providers.descriptors(), models: await connections.listModels() };
  }

  register(IPC_CHANNELS.aiGetState, state);

  function copilotServices() {
    if (deps.copilot === undefined) throw new AppError('AI_UNSUPPORTED', 'The Copilot runtime is not installed in this environment.');
    return deps.copilot;
  }

  async function copilotProvider(payload: unknown) {
    const id = boundedString(asRecord(payload)['providerId'], 100);
    const provider = (await settings.get()).providers.find((entry) => entry.id === id && entry.kind === 'copilot');
    if (provider === undefined) throw new AppError('AI_NOT_FOUND', 'This Copilot connection no longer exists.');
    return provider;
  }

  async function connectCopilot(payload: unknown) {
    const provider = await copilotProvider(payload);
    const { runtime, auth } = copilotServices();
    const status = await runtime.connect(provider.id, await auth.token(provider.id));
    await settings.setCopilotConnected(provider.id, status.state === 'connected');
    if (status.state === 'connected') await connections.refreshModels(provider.id);
    return status;
  }

  register(IPC_CHANNELS.copilotStatus, async (payload) => copilotServices().runtime.status((await copilotProvider(payload)).id));
  register(IPC_CHANNELS.copilotConnect, connectCopilot);
  register(IPC_CHANNELS.copilotLogin, async (payload) => {
    const provider = await copilotProvider(payload);
    return copilotServices().auth.begin(provider.id, provider.oauthClientId ?? '');
  });
  register(IPC_CHANNELS.copilotFinishLogin, async (payload) => {
    const provider = await copilotProvider(payload);
    const { auth, runtime } = copilotServices();
    await auth.finish(provider.id);
    await runtime.stop(provider.id);
    return connectCopilot(payload);
  });
  register(IPC_CHANNELS.copilotRun, async (payload) => {
    const request = asRecord(payload);
    const parsed = parseTurn(payload);
    const conversationId = boundedString(request['conversationId'], 100);
    if (!/^[A-Za-z0-9-]{8,100}$/.test(conversationId)) throw invalidRequest();
    const { sessions, publish } = copilotServices();
    return sessions.run({ ...parsed, conversationId }, publish);
  });
  register(IPC_CHANNELS.copilotResult, async (payload) => {
    const request = asRecord(payload);
    if (typeof request['isError'] !== 'boolean') throw invalidRequest();
    const images = request['images'] === undefined ? [] : request['images'];
    if (!Array.isArray(images) || images.length > 8) throw invalidRequest();
    const parsedImages = images.map((image) => {
      const part = asRecord(image);
      const mediaType = boundedString(part['mediaType'], 50);
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mediaType)) throw invalidRequest();
      return { mediaType, data: boundedString(part['data'], 8_000_000) };
    });
    copilotServices().sessions.result({ requestId: boundedString(request['requestId'], 100), callId: boundedString(request['callId'], 200), content: boundedString(request['content'], 300_000), isError: request['isError'], images: parsedImages });
  });
  register(IPC_CHANNELS.copilotCancel, (payload) => copilotServices().sessions.cancel(boundedString(asRecord(payload)['requestId'], 100)));

  register(IPC_CHANNELS.aiSaveProvider, async (payload) => {
    const saved = await settings.saveProvider(parseProviderInput(payload));
    // Models are discovered best-effort: a provider that is down must not block saving it.
    if (saved.kind !== 'copilot') await connections.refreshModels(saved.id).catch(() => undefined);
    return state();
  });

  register(IPC_CHANNELS.aiRemoveProvider, async (payload) => {
    const providerId = requireString(asRecord(payload)['providerId']);
    if (deps.copilot !== undefined) {
      await deps.copilot.sessions.forget(providerId);
      await deps.copilot.runtime.disconnect(providerId);
      await deps.copilot.auth.disconnect(providerId);
    }
    await settings.removeProvider(providerId);
    await models.forget(providerId);
    return state();
  });

  register(IPC_CHANNELS.aiDisconnectProvider, async (payload) => {
    const id = requireString(asRecord(payload)['providerId']);
    if (deps.copilot !== undefined) {
      await deps.copilot.sessions.forget(id);
      await deps.copilot.runtime.disconnect(id);
      await deps.copilot.auth.disconnect(id);
      await settings.setCopilotConnected(id, false);
      await models.forget(id);
    }
    await settings.disconnectProvider(id);
    return state();
  });

  register(IPC_CHANNELS.aiTestProvider, (payload) => connections.validate(parseProviderInput(payload)));

  register(IPC_CHANNELS.aiRefreshModels, async (payload) => {
    await connections.refreshModels(requireString(asRecord(payload)['providerId']));
    return state();
  });

  register(IPC_CHANNELS.aiUpdatePreferences, async (payload) => {
    await settings.updatePreferences(parsePreferences(payload));
    return state();
  });

  register(IPC_CHANNELS.aiRunTurn, (payload) => turns.run(parseTurn(payload)));

  register(IPC_CHANNELS.aiCancelTurn, (payload) => turns.cancel(requireString(asRecord(payload)['requestId'])));

  register(IPC_CHANNELS.aiListConversations, () => conversations.list());

  register(IPC_CHANNELS.aiLoadConversation, (payload) => conversations.load(requireString(asRecord(payload)['id'])));

  register(IPC_CHANNELS.aiSaveConversation, (payload) => {
    const conversation = parseConversation(payload);
    if (conversation === null) {
      throw invalidRequest();
    }
    return conversations.save(conversation);
  });

  register(IPC_CHANNELS.aiRenameConversation, (payload) => {
    const request = asRecord(payload);
    return conversations.rename(requireString(request['id']), requireString(request['title']));
  });

  register(IPC_CHANNELS.aiDeleteConversation, (payload) => conversations.delete(requireString(asRecord(payload)['id'])));

  register(IPC_CHANNELS.aiClearConversations, () => conversations.clear());

  register(IPC_CHANNELS.aiPickAttachments, async () => {
    const files = await attachmentPicker.pickFiles();
    return readAttachments(files, (await settings.get()).limits.maxAttachmentBytes);
  });

  register(IPC_CHANNELS.aiListMcpServers, () => mcp.statuses());

  register(IPC_CHANNELS.aiSaveMcpServer, async (payload) => {
    const saved = await settings.saveMcpServer(parseMcpInput(payload));
    // The configuration may have changed, so the old connection must not stay open.
    await mcp.disconnect(saved.id);
    return state();
  });

  register(IPC_CHANNELS.aiRemoveMcpServer, async (payload) => {
    const serverId = requireString(asRecord(payload)['serverId']);
    await mcp.disconnect(serverId);
    await settings.removeMcpServer(serverId);
    return state();
  });

  register(IPC_CHANNELS.aiConnectMcpServer, (payload) => mcp.connect(requireString(asRecord(payload)['serverId'])));

  register(IPC_CHANNELS.aiDisconnectMcpServer, (payload) => mcp.disconnect(requireString(asRecord(payload)['serverId'])));

  register(IPC_CHANNELS.aiTestMcpServer, (payload) => mcp.test(requireString(asRecord(payload)['serverId'])));

  register(IPC_CHANNELS.aiListMcpTools, () => mcp.tools());

  register(IPC_CHANNELS.aiCallMcpTool, (payload) => {
    const request = asRecord(payload);
    return mcp.call(requireString(request['serverId']), requireString(request['tool']), asRecord(request['input']));
  });
}
