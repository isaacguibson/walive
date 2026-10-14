import { useEffect, useRef } from 'react';
import type { ToolPermission, ToolStatus } from '@shared/ai/types';
import type { ApprovalRequest } from '@shared/ai/runtime';
import type { AgentSnapshot } from '../../ai/agentController';
import { Markdown } from './Markdown';

const STATUS_LABELS: Record<ToolStatus, string> = {
  running: 'Running',
  'awaiting-approval': 'Waiting for approval',
  completed: 'Done',
  failed: 'Failed',
  denied: 'Rejected',
  cancelled: 'Cancelled'
};

const PERMISSION_LABELS: Record<ToolPermission, string> = {
  read: 'Read only',
  modify: 'Changes the project',
  external: 'External service',
  sensitive: 'Destructive'
};

function ApprovalCard({ request, onRespond }: { request: ApprovalRequest; onRespond(approved: boolean): void }) {
  return (
    <div className="ai-approval" role="group" aria-label={`Approval needed: ${request.title}`}>
      <dl>
        <dt>Operation</dt>
        <dd>{request.operation}</dd>
        <dt>Target</dt>
        <dd>{request.target}</dd>
        <dt>Effect</dt>
        <dd>{request.effect}</dd>
        {request.risk !== null && (
          <>
            <dt>Risk</dt>
            <dd className="form-error">{request.risk}</dd>
          </>
        )}
      </dl>
      <div className="ai-approval-actions">
        <button type="button" className="button button-small button-primary" onClick={() => onRespond(true)}>
          Approve
        </button>
        <button type="button" className="button button-small" onClick={() => onRespond(false)}>
          Reject
        </button>
      </div>
    </div>
  );
}

interface MessageListProps {
  snapshot: AgentSnapshot;
  onRespond(approved: boolean): void;
  onRetry(): void;
}

/** Conversation, tool activity, pending approvals and the answer being generated. */
export function MessageList({ snapshot, onRespond, onRetry }: MessageListProps) {
  const { conversation, streaming, activity, running, approval } = snapshot;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const end = endRef.current;
    if (end !== null) {
      end.parentElement?.scrollTo?.({ top: end.parentElement.scrollHeight });
    }
  }, [conversation.entries.length, streaming, approval]);

  if (conversation.entries.length === 0 && !running) {
    return (
      <div className="ai-chat-empty">
        <p className="empty-title">Ask the assistant to inspect or edit your animation</p>
        <p className="muted">
          {snapshot.model === null ? 'Add a provider in the AI settings to start.' : 'It works on the open scene and asks before anything destructive.'}
        </p>
      </div>
    );
  }

  const lastIndex = conversation.entries.length - 1;
  return (
    <div className="ai-messages" role="log" aria-label="Conversation">
      {conversation.entries.map((entry, index) => {
        switch (entry.kind) {
          case 'user': {
            const first = entry.message.content[0];
            return (
              <div key={entry.id} className="ai-message ai-user">
                <p className="ai-text">{first?.type === 'text' ? first.text : ''}</p>
                {entry.attachments.length > 0 && (
                  <ul className="ai-chips" aria-label="Attachments">
                    {entry.attachments.map((attachment, attachmentIndex) => (
                      <li key={attachmentIndex}>{attachment.name}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          }
          case 'assistant':
            return entry.message.text === '' ? null : (
              <div key={entry.id} className="ai-message ai-assistant">
                <Markdown text={entry.message.text} />
              </div>
            );
          case 'tool':
            return (
              <details key={entry.id} className={`ai-tool ai-tool-${entry.status}`} open={entry.status === 'awaiting-approval'}>
                <summary>
                  <span className="ai-tool-title">{entry.title}</span>
                  <span className="ai-tool-status">{STATUS_LABELS[entry.status]}</span>
                </summary>
                <p className="muted">
                  {entry.name} · {PERMISSION_LABELS[entry.permission]}
                </p>
                <p>{entry.summary}</p>
                {entry.status === 'awaiting-approval' && approval?.callId === entry.callId && <ApprovalCard request={approval} onRespond={onRespond} />}
              </details>
            );
          case 'notice':
            return (
              <div key={entry.id} className={`ai-notice ai-notice-${entry.level}`} role={entry.level === 'error' ? 'alert' : 'status'}>
                <span>{entry.text}</span>
                {entry.retryable && index === lastIndex && !running && (
                  <button type="button" className="button button-small" onClick={onRetry}>
                    Retry
                  </button>
                )}
              </div>
            );
        }
      })}
      {streaming !== '' && (
        <div className="ai-message ai-assistant" aria-live="polite">
          <Markdown text={streaming} />
        </div>
      )}
      {running && activity !== null && (
        <p className="ai-activity" role="status">
          {activity}…
        </p>
      )}
      <div ref={endRef} />
    </div>
  );
}
