import { AppError } from '../../errors';
import type { ChatMessage, ModelInfo, ProviderDescriptor, ToolCall, TurnResult } from '@shared/ai/types';
import type { AIProviderAdapter, FetchLike, ProviderConnection, TurnParams } from './adapter';
import { parseJsonSafely, parseToolInput, readSse, send } from './http';
import { anthropicCapabilities } from './modelCatalog';

const API_VERSION = '2023-06-01';
const MAX_OUTPUT_TOKENS = 8192;

const DESCRIPTOR: ProviderDescriptor = {
  kind: 'anthropic',
  label: 'Anthropic Claude',
  authHelp: 'Requires an Anthropic API key from console.anthropic.com. A Claude subscription does not include API access.',
  needsApiKey: true,
  customEndpoint: 'optional',
  defaultBaseUrl: 'https://api.anthropic.com',
  available: true,
  unavailableReason: null
};

type Block = Record<string, unknown>;
interface WireMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

function toWire(messages: ChatMessage[]): WireMessage[] {
  const wire: WireMessage[] = [];
  const push = (role: WireMessage['role'], blocks: Block[]): void => {
    const last = wire[wire.length - 1];
    if (last?.role === role) {
      last.content.push(...blocks);
    } else {
      wire.push({ role, content: blocks });
    }
  };
  for (const message of messages) {
    if (message.role === 'user') {
      push('user', message.content.map((part) => (part.type === 'text' ? { type: 'text', text: part.text } : { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.data } })));
    } else if (message.role === 'assistant') {
      push('assistant', [
        ...(message.text === '' ? [] : [{ type: 'text', text: message.text }]),
        ...message.toolCalls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input ?? {} }))
      ]);
    } else {
      push('user', [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content, is_error: message.isError }]);
    }
  }
  return wire;
}

function stopReason(reason: unknown): TurnResult['stopReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    default:
      return 'other';
  }
}

interface PartialCall {
  id: string;
  name: string;
  json: string;
}

/** Anthropic Messages API. Effort is not mapped: no Claude model is claimed to take one. */
export class AnthropicAdapter implements AIProviderAdapter {
  readonly descriptor = DESCRIPTOR;

  constructor(private readonly fetchImpl: FetchLike) {}

  private headers(connection: ProviderConnection): Record<string, string> {
    return { 'Content-Type': 'application/json', 'anthropic-version': API_VERSION, 'x-api-key': connection.apiKey ?? '' };
  }

  async validate(connection: ProviderConnection, signal: AbortSignal): Promise<void> {
    if (connection.apiKey === null) {
      throw new AppError('AI_NOT_CONFIGURED', 'Enter an API key for this provider.');
    }
    await this.listModels(connection, signal);
  }

  async listModels(connection: ProviderConnection, signal: AbortSignal): Promise<ModelInfo[]> {
    const response = await send(this.fetchImpl, `${connection.baseUrl}/v1/models?limit=1000`, { method: 'GET', headers: this.headers(connection) }, [connection.apiKey], signal);
    const body = parseJsonSafely(await response.text()) as { data?: { id?: unknown; display_name?: unknown }[] };
    return (body.data ?? []).flatMap((item) =>
      typeof item.id === 'string'
        ? [
            {
              providerId: connection.providerId,
              id: item.id,
              displayName: typeof item.display_name === 'string' ? item.display_name : item.id,
              source: 'catalog' as const,
              capabilities: anthropicCapabilities(item.id),
              available: true
            }
          ]
        : []
    );
  }

  async runTurn(connection: ProviderConnection, params: TurnParams, onDelta: (text: string) => void, signal: AbortSignal): Promise<TurnResult> {
    const body = {
      model: params.modelId,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: params.system,
      messages: toWire(params.messages),
      stream: true,
      ...(params.tools.length > 0 ? { tools: params.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })) } : {})
    };
    const response = await send(this.fetchImpl, `${connection.baseUrl}/v1/messages`, { method: 'POST', headers: this.headers(connection), body: JSON.stringify(body) }, [connection.apiKey], signal);

    let text = '';
    let reason: unknown;
    let complete = false;
    const calls = new Map<number, PartialCall>();
    for await (const data of readSse(response, signal)) {
      const event = parseJsonSafely(data) as { type?: string; index?: number; content_block?: { type?: string; id?: string; name?: string }; delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: unknown } };
      switch (event.type) {
        case 'content_block_start':
          if (event.content_block?.type === 'tool_use') {
            calls.set(event.index ?? 0, { id: event.content_block.id ?? '', name: event.content_block.name ?? '', json: '' });
          }
          break;
        case 'content_block_delta':
          if (event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
            text += event.delta.text;
            onDelta(event.delta.text);
          } else if (event.delta?.type === 'input_json_delta') {
            const call = calls.get(event.index ?? 0);
            if (call !== undefined) {
              call.json += event.delta.partial_json ?? '';
            }
          }
          break;
        case 'message_delta':
          reason = event.delta?.stop_reason ?? reason;
          break;
        case 'message_stop':
          complete = true;
          break;
        case 'error':
          throw new AppError('AI_PROVIDER_ERROR', 'The provider stopped the response with an error.');
      }
    }
    if (!complete) {
      throw new AppError('AI_NETWORK', 'The response was interrupted before it finished.');
    }
    const toolCalls: ToolCall[] = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => ({ id: call.id, name: call.name, input: parseToolInput(call.json) }));
    return { text, toolCalls, stopReason: toolCalls.length > 0 ? 'tool_calls' : stopReason(reason) };
  }
}
