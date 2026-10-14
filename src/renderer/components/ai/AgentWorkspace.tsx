import { useEffect, useState, useSyncExternalStore } from 'react';
import type { EditorSession } from '@editor/editorSession';
import type { AIAPI, AssetsAPI, ScenesAPI } from '@shared/types/api';
import type { AgentController } from '../../ai/agentController';
import { createEditorToolHost } from '../../ai/editorToolHost';
import { IconButton } from '../editor/IconButton';
import { AISettingsDialog } from './AISettingsDialog';
import { Composer } from './Composer';
import { ConversationList } from './ConversationList';
import { MessageList } from './MessageList';

interface AgentWorkspaceProps {
  controller: AgentController;
  aiApi: AIAPI;
  session: EditorSession;
  projectName: string;
  scene: { id: string; name: string };
  scenesApi: ScenesAPI;
  assetsApi: AssetsAPI;
  width: number;
}

/** The AI Agent Workspace: conversation, activity and approvals, and the composer. */
export function AgentWorkspace({ controller, aiApi, session, projectName, scene, scenesApi, assetsApi, width }: AgentWorkspaceProps) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // The agent edits through the editor of the open scene; it loses access as soon as that editor goes away.
  useEffect(() => {
    controller.bindProject({ host: createEditorToolHost({ session, projectName, scene, scenesApi, assetsApi }), sceneId: scene.id });
    return () => controller.bindProject(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, session, projectName, scene.id, scene.name, scenesApi, assetsApi]);

  const { conversation, running, ai } = snapshot;

  return (
    <section className="editor-ai-panel" role="region" aria-label="AI Assistant" style={{ width }}>
      <div className="panel-title-row ai-header">
        <h2 className="panel-title">AI Assistant</h2>
        <div className="ai-header-actions">
          <IconButton icon="plus" label="New conversation" size={16} disabled={running} onClick={() => { controller.startNewConversation(); setShowHistory(false); }} />
          <IconButton icon="history" label="Conversations" size={16} pressed={showHistory} variant="toggle" onClick={() => setShowHistory(!showHistory)} />
          <IconButton icon="settings" label="AI Settings" size={16} disabled={ai === null} onClick={() => setShowSettings(true)} />
        </div>
      </div>
      <p className="ai-conversation-title" title={conversation.title}>
        {conversation.title}
      </p>

      {snapshot.error !== null && (
        <div className="ai-error" role="alert">
          <span>{snapshot.error}</span>
          <IconButton icon="close" label="Dismiss AI message" size={12} onClick={() => controller.clearError()} />
        </div>
      )}

      {showHistory ? (
        <ConversationList
          conversations={snapshot.conversations}
          activeId={conversation.id}
          disabled={running}
          onOpen={(id) => { void controller.openConversation(id); setShowHistory(false); }}
          onRename={(id, title) => void controller.renameConversation(id, title)}
          onDelete={(id) => void controller.deleteConversation(id)}
        />
      ) : (
        <MessageList snapshot={snapshot} onRespond={(approved) => controller.respondToApproval(approved)} onRetry={() => void controller.retry()} />
      )}

      <Composer
        snapshot={snapshot}
        onText={(text) => controller.setDraftText(text)}
        onSend={() => void controller.send()}
        onStop={() => controller.stop()}
        onAttach={() => void controller.attachFiles()}
        onRemoveAttachment={(id) => controller.removeAttachment(id)}
        onModel={(providerId, modelId) => void controller.selectModel(providerId, modelId)}
        onEffort={(effort) => void controller.setEffort(effort)}
      />

      {showSettings && ai !== null && (
        <AISettingsDialog
          ai={ai}
          api={aiApi}
          conversationCount={snapshot.conversations.length}
          onState={(state) => controller.setAiState(state)}
          onClearConversations={() => controller.clearConversations()}
          onClose={() => setShowSettings(false)}
        />
      )}
    </section>
  );
}
