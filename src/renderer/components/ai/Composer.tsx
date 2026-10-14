import type { KeyboardEvent } from 'react';
import type { EffortLevel, ModelInfo, Support } from '@shared/ai/types';
import type { AgentSnapshot } from '../../ai/agentController';
import { IconButton } from '../editor/IconButton';

const EFFORT_LABELS: Record<EffortLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', max: 'Maximum' };

/** What a model is known to do; `?` marks what the provider did not confirm. */
export function describeCapabilities(model: ModelInfo): string {
  const flag = (name: string, support: Support): string[] => (support === 'yes' ? [name] : support === 'unknown' ? [`${name}?`] : []);
  const { capabilities } = model;
  return [...flag('Tools', capabilities.tools), ...flag('Images', capabilities.image), ...flag('Streaming', capabilities.streaming), ...(capabilities.efforts.length > 0 ? ['Effort'] : [])].join(' · ');
}

interface ComposerProps {
  snapshot: AgentSnapshot;
  onText(text: string): void;
  onSend(): void;
  onStop(): void;
  onAttach(): void;
  onRemoveAttachment(id: string): void;
  onModel(providerId: string, modelId: string): void;
  onEffort(effort: EffortLevel): void;
}

/** Message input with attachments, model and effort selectors, and the Send or Stop action. */
export function Composer({ snapshot, onText, onSend, onStop, onAttach, onRemoveAttachment, onModel, onEffort }: ComposerProps) {
  const { draft, model, effort, running, sendBlock, ai } = snapshot;
  const providers = new Map((ai?.settings.providers ?? []).map((provider) => [provider.id, provider.name]));
  const canSend = sendBlock === null && draft.text.trim() !== '';

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  }

  return (
    <div className="ai-composer">
      {draft.attachments.length > 0 && (
        <ul className="ai-chips" aria-label="Attachments">
          {draft.attachments.map((attachment) => (
            <li key={attachment.id}>
              <span title={`${attachment.kind}, ${Math.max(1, Math.round(attachment.size / 1024))} KB`}>{attachment.name}</span>
              <button type="button" aria-label={`Remove ${attachment.name}`} title={`Remove ${attachment.name}`} onClick={() => onRemoveAttachment(attachment.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        aria-label="Message"
        placeholder="Ask the assistant…"
        rows={3}
        value={draft.text}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {sendBlock !== null && !running && (
        <p className="field-hint" role="note">
          {sendBlock}
        </p>
      )}
      {draft.attachments.length > 0 && <p className="field-hint">Attached content is sent to the selected provider.</p>}
      <div className="ai-composer-bar">
        <IconButton icon="plus" label="Attach files" tooltip="Attach files or documents" size={16} disabled={running} onClick={onAttach} />
        <select
          aria-label="Model"
          value={model === null ? '' : `${model.providerId}/${model.id}`}
          disabled={running || (ai?.models.length ?? 0) === 0}
          onChange={(event) => {
            const chosen = ai?.models.find((candidate) => `${candidate.providerId}/${candidate.id}` === event.target.value);
            if (chosen !== undefined) {
              onModel(chosen.providerId, chosen.id);
            }
          }}
        >
          {model === null && <option value="">{(ai?.models.length ?? 0) === 0 ? 'No models' : 'Select a model'}</option>}
          {(ai?.models ?? []).map((candidate) => (
            <option key={`${candidate.providerId}/${candidate.id}`} value={`${candidate.providerId}/${candidate.id}`} disabled={!candidate.available}>
              {`${providers.get(candidate.providerId) ?? 'Provider'} · ${candidate.displayName}`}
            </option>
          ))}
        </select>
        {model !== null && model.capabilities.efforts.length > 0 && (
          <select aria-label="Effort" value={effort ?? ''} disabled={running} onChange={(event) => onEffort(event.target.value as EffortLevel)}>
            {model.capabilities.efforts.map((level) => (
              <option key={level} value={level}>
                {EFFORT_LABELS[level]}
              </option>
            ))}
          </select>
        )}
        {running ? (
          <IconButton icon="stop" label="Stop" variant="primary" tooltip="Stop" size={16} onClick={onStop} />
        ) : (
          <IconButton icon="paperPlane" variant="primary" label="Send" tooltip="Send" size={16} disabled={!canSend} onClick={onSend} />
        )}
      </div>
      {model !== null && (
        <p className="field-hint" title="A question mark means the provider did not confirm the capability.">
          {describeCapabilities(model)}
        </p>
      )}
    </div>
  );
}
