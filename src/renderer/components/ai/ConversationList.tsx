import { useState } from 'react';
import type { ConversationSummary } from '@shared/ai/types';

interface ConversationListProps {
  conversations: readonly ConversationSummary[];
  activeId: string;
  disabled: boolean;
  onOpen(id: string): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}

/** Saved conversations: continue, rename or delete them. */
export function ConversationList({ conversations, activeId, disabled, onOpen, onRename, onDelete }: ConversationListProps) {
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  if (conversations.length === 0) {
    return <p className="muted">No saved conversations yet.</p>;
  }
  return (
    <ul className="ai-conversations" aria-label="Conversations">
      {conversations.map((conversation) => (
        <li key={conversation.id} className={conversation.id === activeId ? 'is-active' : ''}>
          {renaming?.id === conversation.id ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onRename(conversation.id, renaming.title);
                setRenaming(null);
              }}
            >
              <input aria-label="Conversation title" value={renaming.title} maxLength={80} autoFocus onChange={(event) => setRenaming({ id: conversation.id, title: event.target.value })} />
              <button type="submit" className="button button-small">
                Save
              </button>
            </form>
          ) : (
            <>
              <button type="button" className="ai-conversation-open" disabled={disabled} onClick={() => onOpen(conversation.id)}>
                <span>{conversation.title}</span>
                <span className="muted">{new Date(conversation.updatedAt).toLocaleString()}</span>
              </button>
              <button type="button" className="button button-small" aria-label={`Rename ${conversation.title}`} title="Rename" onClick={() => setRenaming({ id: conversation.id, title: conversation.title })}>
                Rename
              </button>
              <button type="button" className="button button-small" aria-label={`Delete ${conversation.title}`} title="Delete" disabled={disabled && conversation.id === activeId} onClick={() => onDelete(conversation.id)}>
                Delete
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
