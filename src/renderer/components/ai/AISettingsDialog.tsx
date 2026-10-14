import { useState } from 'react';
import type { AIState } from '@shared/ai/types';
import type { AIAPI } from '@shared/types/api';
import { Dialog } from '../Dialog';
import { AgentSettingsPanel } from './AgentSettingsPanel';
import { McpPanel } from './McpPanel';
import { ProvidersPanel } from './ProvidersPanel';

type Tab = 'providers' | 'mcp' | 'agent';

const TABS: { id: Tab; label: string }[] = [
  { id: 'providers', label: 'AI Providers' },
  { id: 'agent', label: 'Agent' }
];

interface AISettingsDialogProps {
  ai: AIState;
  api: AIAPI;
  conversationCount: number;
  onState(state: AIState): void;
  onClearConversations(): Promise<void>;
  onClose(): void;
}

/** Everything about the AI features that the user can configure, in one place. */
export function AISettingsDialog({ ai, api, conversationCount, onState, onClearConversations, onClose }: AISettingsDialogProps) {
  const [tab, setTab] = useState<Tab>('providers');
  return (
    <Dialog title="AI Settings" titleId="ai-settings-title" className="dialog-wide ai-settings" onCancel={onClose}>
      <div role="tablist" aria-label="AI settings sections" className="ai-tabs">
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'providers' && <ProvidersPanel ai={ai} api={api} onState={onState} />}
      {tab === 'agent' && <AgentSettingsPanel ai={ai} api={api} conversationCount={conversationCount} onState={onState} onClearConversations={onClearConversations} />}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
