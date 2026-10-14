import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppError, isNodeError } from '../errors';
import { CONVERSATION_ID, parseConversation } from '@shared/ai/validation';
import type { Conversation, ConversationSummary } from '@shared/ai/types';
import { JsonFile } from './jsonFile';

const MAX_TITLE = 80;

/** Images are not kept on disk: a placeholder stays so that the history still reads correctly. */
function withoutImages(conversation: Conversation): Conversation {
  const entries = conversation.entries.map((entry) =>
    entry.kind === 'user'
      ? { ...entry, message: { ...entry.message, content: entry.message.content.map((part) => (part.type === 'image' ? { type: 'text' as const, text: '[An image was attached here; it is not stored.]' } : part)) } }
      : entry
  );
  return { ...conversation, entries };
}

function requireId(id: string): void {
  if (!CONVERSATION_ID.test(id)) {
    throw new AppError('INVALID_REQUEST', 'The request could not be processed.');
  }
}

/** One JSON file per conversation, kept apart from project files. */
export class ConversationRepository {
  constructor(private readonly directory: string) {}

  private file(id: string): JsonFile<Conversation | null> {
    requireId(id);
    return new JsonFile(path.join(this.directory, `${id}.json`), (value) => (value === undefined ? null : parseConversation(value)), 'The conversation');
  }

  async list(): Promise<ConversationSummary[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.directory);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw new AppError('STATE_READ_FAILED', 'Conversations could not be loaded.', { cause: error });
    }
    const conversations = await Promise.all(
      names.filter((name) => name.endsWith('.json')).map((name) => this.load(name.slice(0, -'.json'.length)).catch(() => null))
    );
    return conversations
      .flatMap((conversation) => (conversation === null ? [] : [conversation]))
      .map(({ entries, ...rest }): ConversationSummary => ({ id: rest.id, title: rest.title, createdAt: rest.createdAt, updatedAt: rest.updatedAt, providerId: rest.providerId, modelId: rest.modelId, entryCount: entries.length }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async load(id: string): Promise<Conversation | null> {
    return this.file(id).read();
  }

  async save(conversation: Conversation): Promise<void> {
    await this.file(conversation.id).write({ ...withoutImages(conversation), title: conversation.title.trim().slice(0, MAX_TITLE) || 'New conversation' });
  }

  async rename(id: string, title: string): Promise<void> {
    const name = title.trim();
    if (name === '' || name.length > MAX_TITLE) {
      throw new AppError('INVALID_REQUEST', `Enter a title of up to ${MAX_TITLE} characters.`);
    }
    const conversation = await this.load(id);
    if (conversation === null) {
      throw new AppError('AI_NOT_FOUND', 'This conversation no longer exists.');
    }
    await this.save({ ...conversation, title: name });
  }

  async delete(id: string): Promise<void> {
    requireId(id);
    await fs.rm(path.join(this.directory, `${id}.json`), { force: true });
  }

  /** Removes every stored conversation. Nothing else is stored with them: attachments are not kept. */
  async clear(): Promise<number> {
    const summaries = await this.list();
    await Promise.all(summaries.map((summary) => this.delete(summary.id)));
    return summaries.length;
  }
}
