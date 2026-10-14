import type {
  AttachmentInfo,
  ChatMessage,
  ContentPart,
  Conversation,
  ConversationEntry,
  EffortLevel,
  ToolCall,
  ToolPermission,
  ToolSpec,
  ToolStatus
} from './types';
import { EFFORT_LEVELS } from './types';

/**
 * Runtime checks for data that crosses a process boundary or comes from disk. Every function
 * returns `null` for anything that does not have the exact expected shape.
 */

const MAX_MESSAGES = 4_000;
const MAX_TOOLS = 128;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function parseToolCall(value: unknown): ToolCall | null {
  if (!isRecord(value) || !isString(value['id']) || !isString(value['name'])) {
    return null;
  }
  const input = value['input'];
  if (input !== null && !isRecord(input)) {
    return null;
  }
  return { id: value['id'], name: value['name'], input };
}

function parsePart(value: unknown): ContentPart | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value['type'] === 'text' && isString(value['text'])) {
    return { type: 'text', text: value['text'] };
  }
  if (value['type'] === 'image' && isString(value['mediaType']) && isString(value['data'])) {
    return { type: 'image', mediaType: value['mediaType'], data: value['data'] };
  }
  return null;
}

export function parseChatMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value['role'] === 'user' && Array.isArray(value['content'])) {
    const content = value['content'].map(parsePart);
    return content.every((part) => part !== null) ? { role: 'user', content: content as ContentPart[] } : null;
  }
  if (value['role'] === 'assistant' && isString(value['text']) && Array.isArray(value['toolCalls'])) {
    const toolCalls = value['toolCalls'].map(parseToolCall);
    return toolCalls.every((call) => call !== null) ? { role: 'assistant', text: value['text'], toolCalls: toolCalls as ToolCall[] } : null;
  }
  if (value['role'] === 'tool' && isString(value['toolCallId']) && isString(value['name']) && isString(value['content']) && typeof value['isError'] === 'boolean') {
    return { role: 'tool', toolCallId: value['toolCallId'], name: value['name'], content: value['content'], isError: value['isError'] };
  }
  return null;
}

export function parseChatMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) {
    return null;
  }
  const messages = value.map(parseChatMessage);
  return messages.every((message) => message !== null) ? (messages as ChatMessage[]) : null;
}

export function parseToolSpecs(value: unknown): ToolSpec[] | null {
  if (!Array.isArray(value) || value.length > MAX_TOOLS) {
    return null;
  }
  const specs: ToolSpec[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isString(item['name']) || !isString(item['description']) || !isRecord(item['inputSchema'])) {
      return null;
    }
    specs.push({ name: item['name'], description: item['description'], inputSchema: item['inputSchema'] });
  }
  return specs;
}

export function parseEffort(value: unknown): EffortLevel | null {
  return EFFORT_LEVELS.find((level) => level === value) ?? null;
}

function parseAttachment(value: unknown): AttachmentInfo | null {
  if (!isRecord(value) || !isString(value['name']) || typeof value['size'] !== 'number' || (value['kind'] !== 'image' && value['kind'] !== 'text')) {
    return null;
  }
  return { name: value['name'], kind: value['kind'], size: value['size'] };
}

const TOOL_STATUSES = ['running', 'awaiting-approval', 'completed', 'failed', 'denied', 'cancelled'];
const PERMISSIONS = ['read', 'modify', 'external', 'sensitive'];
const NOTICE_LEVELS = ['info', 'completed', 'cancelled', 'error'];

function parseEntry(value: unknown): ConversationEntry | null {
  if (!isRecord(value) || !isString(value['id']) || !isString(value['at'])) {
    return null;
  }
  const base = { id: value['id'], at: value['at'] };
  const message = parseChatMessage(value['message']);
  switch (value['kind']) {
    case 'user': {
      const attachments = Array.isArray(value['attachments']) ? value['attachments'].map(parseAttachment) : null;
      return message?.role === 'user' && attachments !== null && attachments.every((a) => a !== null)
        ? { ...base, kind: 'user', message, attachments: attachments as AttachmentInfo[] }
        : null;
    }
    case 'assistant':
      return message?.role === 'assistant' ? { ...base, kind: 'assistant', message } : null;
    case 'tool':
      if (
        isString(value['callId']) && isString(value['name']) && isString(value['title']) && isString(value['summary']) &&
        PERMISSIONS.includes(value['permission'] as string) && TOOL_STATUSES.includes(value['status'] as string) &&
        (value['message'] === null || message?.role === 'tool')
      ) {
        const status = value['status'] as ToolStatus;
        const permission = value['permission'] as ToolPermission;
        return {
          ...base,
          kind: 'tool',
          callId: value['callId'],
          name: value['name'],
          title: value['title'],
          permission,
          // A call that was running when the application closed never finished.
          status: status === 'running' || status === 'awaiting-approval' ? 'cancelled' : status,
          summary: value['summary'],
          message: message?.role === 'tool' ? message : null
        };
      }
      return null;
    case 'notice':
      return isString(value['text']) && NOTICE_LEVELS.includes(value['level'] as string) && typeof value['retryable'] === 'boolean'
        ? { ...base, kind: 'notice', level: value['level'] as 'info' | 'completed' | 'cancelled' | 'error', text: value['text'], retryable: value['retryable'] }
        : null;
    default:
      return null;
  }
}

/** The conversation id doubles as a file name, so it must not be able to escape the folder. */
export const CONVERSATION_ID = /^[a-zA-Z0-9-]{8,64}$/;

export function parseConversation(value: unknown): Conversation | null {
  if (
    !isRecord(value) || !isString(value['id']) || !CONVERSATION_ID.test(value['id']) || !isString(value['title']) ||
    !isString(value['createdAt']) || !isString(value['updatedAt']) || !Array.isArray(value['entries']) || value['entries'].length > MAX_MESSAGES
  ) {
    return null;
  }
  const providerId = value['providerId'];
  const modelId = value['modelId'];
  if ((providerId !== null && !isString(providerId)) || (modelId !== null && !isString(modelId))) {
    return null;
  }
  const entries = value['entries'].map(parseEntry);
  if (!entries.every((entry) => entry !== null)) {
    return null;
  }
  return {
    id: value['id'],
    title: value['title'],
    createdAt: value['createdAt'],
    updatedAt: value['updatedAt'],
    providerId,
    modelId,
    entries: entries as ConversationEntry[]
  };
}
