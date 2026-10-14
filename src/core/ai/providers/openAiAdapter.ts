import { AppError } from '../../errors';
import type { ChatMessage, ModelCapabilities, ModelInfo, ProviderDescriptor, ToolCall, TurnResult } from '@shared/ai/types';
import type { AIProviderAdapter, FetchLike, ProviderConnection, TurnParams } from './adapter';
import { parseJsonSafely, parseToolInput, readSse, send } from './http';
import { UNKNOWN_CAPABILITIES, openAiCapabilities } from './modelCatalog';

const OPENAI_DESCRIPTOR: ProviderDescriptor = {
  kind: 'openai',
  label: 'OpenAI',
  authHelp: 'Requires an OpenAI API key from platform.openai.com. A ChatGPT subscription does not include API access.',
  needsApiKey: true,
  customEndpoint: 'optional',
  defaultBaseUrl: 'https://api.openai.com/v1',
  available: true,
  unavailableReason: null
};

const COMPATIBLE_DESCRIPTOR: ProviderDescriptor = {
  kind: 'openai-compatible',
  label: 'OpenAI-compatible API',
  authHelp: 'For servers that implement the OpenAI chat completions API (local servers, gateways, other vendors). The API key is optional when the server does not need one.',
  needsApiKey: false,
  customEndpoint: 'required',
  defaultBaseUrl: null,
  available: true,
  unavailableReason: null
};

type ChatCompletionMessage = Record<string, unknown>;

function toWire(system: string, messages: ChatMessage[]): ChatCompletionMessage[] {
  const wire: ChatCompletionMessage[] = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (message.role === 'user') {
      const parts = message.content.map((part) =>
        part.type === 'text' ? { type: 'text', text: part.text } : { type: 'image_url', image_url: { url: `data:${part.mediaType};base64,${part.data}` } }
      );
      wire.push({ role: 'user', content: parts });
    } else if (message.role === 'assistant') {
      wire.push({
        role: 'assistant',
        content: message.text === '' ? null : message.text,
        ...(message.toolCalls.length > 0
          ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) } })) }
          : {})
      });
    } else {
      wire.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
    }
  }
  return wire;
}

function stopReason(finish: unknown, hasTools: boolean): TurnResult['stopReason'] {
  if (hasTools || finish === 'tool_calls' || finish === 'function_call') {
    return 'tool_calls';
  }
  if (finish === 'length') {
    return 'length';
  }
  return finish === 'stop' || finish === null || finish === undefined ? 'end' : 'other';
}

interface PartialCall {
  id: string;
  name: string;
  args: string;
}

/** Chat Completions API: OpenAI itself and every server that speaks the same protocol. */
export class OpenAiAdapter implements AIProviderAdapter {
  readonly descriptor: ProviderDescriptor;

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly official: boolean
  ) {
    this.descriptor = official ? OPENAI_DESCRIPTOR : COMPATIBLE_DESCRIPTOR;
  }

  private headers(connection: ProviderConnection): Record<string, string> {
    return { 'Content-Type': 'application/json', ...(connection.apiKey === null ? {} : { Authorization: `Bearer ${connection.apiKey}` }) };
  }

  async validate(connection: ProviderConnection, signal: AbortSignal): Promise<void> {
    if (this.official && connection.apiKey === null) {
      throw new AppError('AI_NOT_CONFIGURED', 'Enter an API key for this provider.');
    }
    await this.listModels(connection, signal);
  }

  async listModels(connection: ProviderConnection, signal: AbortSignal): Promise<ModelInfo[]> {
    let response: Response;
    try {
      response = await send(this.fetchImpl, `${connection.baseUrl}/models`, { method: 'GET', headers: this.headers(connection) }, [connection.apiKey], signal);
    } catch (error) {
      // Many compatible servers have no model list; the user declares their models instead.
      if (!this.official && error instanceof AppError && error.code === 'AI_NOT_FOUND') {
        return [];
      }
      throw error;
    }
    const body = parseJsonSafely(await response.text()) as { data?: { id?: unknown }[] };
    const ids = (body.data ?? []).flatMap((item) => (typeof item.id === 'string' ? [item.id] : []));
    return ids.flatMap((id) => {
      const capabilities: ModelCapabilities | null = this.official ? openAiCapabilities(id) : UNKNOWN_CAPABILITIES;
      return capabilities === null
        ? []
        : [{ providerId: connection.providerId, id, displayName: id, source: this.official ? ('catalog' as const) : ('provider' as const), capabilities, available: true }];
    });
  }

  async runTurn(connection: ProviderConnection, params: TurnParams, onDelta: (text: string) => void, signal: AbortSignal): Promise<TurnResult> {
    const effort = params.effort === null ? null : params.effort === 'max' ? 'high' : params.effort;
    const body = {
      model: params.modelId,
      messages: toWire(params.system, params.messages),
      stream: true,
      ...(params.tools.length > 0
        ? { tools: params.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) }
        : {}),
      ...(effort === null ? {} : { reasoning_effort: effort })
    };
    const response = await send(this.fetchImpl, `${connection.baseUrl}/chat/completions`, { method: 'POST', headers: this.headers(connection), body: JSON.stringify(body) }, [connection.apiKey], signal);

    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      return this.fromMessage(parseJsonSafely(await response.text()), onDelta);
    }
    return this.fromStream(response, onDelta, signal);
  }

  private fromMessage(body: unknown, onDelta: (text: string) => void): TurnResult {
    const choice = (body as { choices?: { message?: { content?: unknown; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: unknown }[] }).choices?.[0];
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    if (text !== '') {
      onDelta(text);
    }
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.function?.name ?? '',
      input: parseToolInput(call.function?.arguments ?? '')
    }));
    return { text, toolCalls, stopReason: stopReason(choice?.finish_reason, toolCalls.length > 0) };
  }

  private async fromStream(response: Response, onDelta: (text: string) => void, signal: AbortSignal): Promise<TurnResult> {
    let text = '';
    let finish: unknown;
    let complete = false;
    const calls = new Map<number, PartialCall>();
    for await (const data of readSse(response, signal)) {
      if (data === '[DONE]') {
        complete = true;
        break;
      }
      const chunk = parseJsonSafely(data) as { error?: { message?: unknown }; choices?: { delta?: { content?: unknown; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: unknown }[] };
      if (chunk.error !== undefined) {
        throw new AppError('AI_PROVIDER_ERROR', 'The provider stopped the response with an error.');
      }
      const choice = chunk.choices?.[0];
      if (typeof choice?.delta?.content === 'string' && choice.delta.content !== '') {
        text += choice.delta.content;
        onDelta(choice.delta.content);
      }
      for (const fragment of choice?.delta?.tool_calls ?? []) {
        const call = calls.get(fragment.index ?? 0) ?? { id: '', name: '', args: '' };
        call.id = fragment.id ?? call.id;
        call.name += fragment.function?.name ?? '';
        call.args += fragment.function?.arguments ?? '';
        calls.set(fragment.index ?? 0, call);
      }
      if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
        finish = choice.finish_reason;
        complete = true;
      }
    }
    if (!complete) {
      throw new AppError('AI_NETWORK', 'The response was interrupted before it finished.');
    }
    const toolCalls: ToolCall[] = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({ id: call.id === '' ? `call_${index}` : call.id, name: call.name, input: parseToolInput(call.args) }));
    return { text, toolCalls, stopReason: stopReason(finish, toolCalls.length > 0) };
  }
}
