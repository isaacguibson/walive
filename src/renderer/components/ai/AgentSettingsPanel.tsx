import { useState } from 'react';
import type { AIState, AgentLimits, ApprovalPolicy } from '@shared/ai/types';
import type { AIAPI } from '@shared/types/api';
import { useAsyncAction } from './useAsyncAction';

const LIMIT_FIELDS: { key: keyof AgentLimits; label: string; unit: number }[] = [
  { key: 'maxIterations', label: 'Maximum steps per task', unit: 1 },
  { key: 'maxToolCalls', label: 'Maximum tool calls per task', unit: 1 },
  { key: 'maxDurationSeconds', label: 'Maximum duration (seconds)', unit: 1 },
  { key: 'maxToolInputBytes', label: 'Maximum tool input (characters)', unit: 1 },
  { key: 'maxToolOutputBytes', label: 'Maximum tool output (characters)', unit: 1 },
  { key: 'maxAttachmentBytes', label: 'Maximum attachment size (KB)', unit: 1024 },
  { key: 'maxContextChars', label: 'Maximum conversation context (characters)', unit: 1 }
];

interface AgentSettingsPanelProps {
  ai: AIState;
  api: AIAPI;
  conversationCount: number;
  onState(state: AIState): void;
  onClearConversations(): Promise<void>;
}

/** Execution limits, approval policy and conversation history. */
export function AgentSettingsPanel({ ai, api, conversationCount, onState, onClearConversations }: AgentSettingsPanelProps) {
  const [limits, setLimits] = useState<AgentLimits>(ai.settings.limits);
  const [approval, setApproval] = useState<ApprovalPolicy>(ai.settings.approval);
  const [confirmClear, setConfirmClear] = useState(false);
  const action = useAsyncAction();

  return (
    <section aria-label="Agent">
      <form
        className="ai-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            const result = await api.updatePreferences({ limits, approval });
            if (!result.ok) {
              return { text: result.error.message, error: true };
            }
            onState(result.value);
            return { text: 'Settings saved.', error: false };
          });
        }}
      >
        <div className="field">
          <label htmlFor="approval-modify">Project changes</label>
          <select id="approval-modify" value={approval.modify} onChange={(event) => setApproval({ ...approval, modify: event.target.value === 'ask' ? 'ask' : 'auto' })}>
            <option value="auto">Apply automatically (can be undone)</option>
            <option value="ask">Ask before each change</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="approval-external">External services (MCP tools)</label>
          <select id="approval-external" value={approval.external} onChange={(event) => setApproval({ ...approval, external: event.target.value === 'auto' ? 'auto' : 'ask' })}>
            <option value="ask">Ask before each call</option>
            <option value="auto">Allow automatically</option>
          </select>
          <p className="field-hint">Destructive operations, such as deleting frames or layers, always ask.</p>
        </div>
        {LIMIT_FIELDS.map(({ key, label, unit }) => (
          <div className="field" key={key}>
            <label htmlFor={`limit-${key}`}>{label}</label>
            <input
              id={`limit-${key}`}
              type="number"
              min={1}
              value={Math.round(limits[key] / unit)}
              onChange={(event) => setLimits({ ...limits, [key]: Math.round(Number(event.target.value)) * unit })}
            />
          </div>
        ))}
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" disabled={action.busy}>
            Save Settings
          </button>
        </div>
      </form>

      <h3>Conversation history</h3>
      {confirmClear ? (
        <div role="group" aria-label="Confirm clearing history">
          <p>
            This permanently deletes {conversationCount} saved conversation(s). Attachments are never stored, so nothing else is removed.
          </p>
          <div className="ai-settings-actions">
            <button
              type="button"
              className="button button-small button-danger"
              onClick={() =>
                void action.run(async () => {
                  await onClearConversations();
                  setConfirmClear(false);
                  return { text: 'Conversation history cleared.', error: false };
                })
              }
            >
              Delete All
            </button>
            <button type="button" className="button button-small" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="button button-small" disabled={conversationCount === 0} onClick={() => setConfirmClear(true)}>
          Clear Conversation History
        </button>
      )}
      {action.message !== null && (
        <p className={action.message.error ? 'form-error' : 'form-status'} role={action.message.error ? 'alert' : 'status'}>
          {action.message.text}
        </p>
      )}
    </section>
  );
}
