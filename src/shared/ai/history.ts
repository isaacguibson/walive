import { AIClientError } from './errors';
import type { ChatMessage } from './types';

const IMAGE_COST = 2_000;

function sizeOf(message: ChatMessage): number {
  switch (message.role) {
    case 'user':
      return message.content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : IMAGE_COST), 0);
    case 'assistant':
      return message.text.length + JSON.stringify(message.toolCalls).length;
    case 'tool':
      return message.content.length;
  }
}

/**
 * Keeps the newest turns that fit in `maxChars`, cutting only at user messages so that no tool
 * result is separated from its call. The latest turn is always kept; when it alone is too large
 * the request cannot be sent.
 */
export function fitContext(messages: ChatMessage[], maxChars: number): { messages: ChatMessage[]; dropped: number } {
  const sizes = messages.map(sizeOf);
  let total = sizes.reduce((sum, size) => sum + size, 0);
  const turnStarts = messages.flatMap((message, index) => (message.role === 'user' ? [index] : []));
  let start = 0;
  let next = 1;
  while (total > maxChars && next < turnStarts.length) {
    const cut = turnStarts[next] ?? messages.length;
    for (let index = start; index < cut; index += 1) {
      total -= sizes[index] ?? 0;
    }
    start = cut;
    next += 1;
  }
  if (total > maxChars) {
    throw new AIClientError('AI_CONTEXT_LIMIT', 'The conversation is too large for the configured context limit. Start a new conversation or attach less content.');
  }
  return { messages: messages.slice(start), dropped: start };
}

/**
 * Removes tool calls that have no result, and results that have no call, so stored history can
 * always be replayed to a provider (for example after a crash in the middle of a task).
 */
export function sanitizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }
    if (message.role === 'tool') {
      continue;
    }
    if (message.role !== 'assistant' || message.toolCalls.length === 0) {
      result.push(message);
      continue;
    }
    const answered = new Set<string>();
    let end = index + 1;
    while (messages[end]?.role === 'tool') {
      const tool = messages[end];
      if (tool?.role === 'tool') {
        answered.add(tool.toolCallId);
      }
      end += 1;
    }
    const calls = message.toolCalls.filter((call) => answered.has(call.id));
    result.push({ ...message, toolCalls: calls });
    for (let toolIndex = index + 1; toolIndex < end; toolIndex += 1) {
      const tool = messages[toolIndex];
      if (tool?.role === 'tool' && calls.some((call) => call.id === tool.toolCallId)) {
        result.push(tool);
      }
    }
    index = end - 1;
  }
  return result.filter((message) => message.role !== 'assistant' || message.text !== '' || message.toolCalls.length > 0);
}
