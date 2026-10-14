import type { AnimationDocument } from '../types/animation';
import type {
  AIPreferences,
  AIState,
  AttachmentPickResult,
  Conversation,
  ConversationSummary,
  McpCallResult,
  McpServerStatus,
  McpToolInfo,
  SaveMcpServerInput,
  SaveProviderInput,
  TurnRequest,
  TurnResult
} from '../ai/types';
import type { AssetImportResult, ProjectAsset } from '../types/assets';
import type {
  DestinationQuery,
  ExportCapabilities,
  ExportDestination,
  ExportRequest,
  ExportResult
} from '../types/export';
import type { ProjectCanvas, ProjectMetadata, RecentProject } from '../types/project';
import type { SceneCollection } from '../types/scenes';

export const IPC_CHANNELS = {
  createProject: 'project:create',
  openProject: 'project:open',
  closeProject: 'project:close',
  getRecentProjects: 'project:get-recent',
  removeRecentProject: 'project:remove-recent',
  selectDirectory: 'project:select-directory',
  listScenes: 'scenes:list',
  createScene: 'scenes:create',
  renameScene: 'scenes:rename',
  deleteScene: 'scenes:delete',
  selectScene: 'scenes:select',
  loadAnimation: 'animation:load',
  saveAnimation: 'animation:save',
  listAssets: 'assets:list',
  readAssetImage: 'assets:read-image',
  importAssets: 'assets:import',
  renameAsset: 'assets:rename',
  deleteAsset: 'assets:delete',
  exportCapabilities: 'export:capabilities',
  exportDestination: 'export:destination',
  exportStart: 'export:start',
  exportCancel: 'export:cancel',
  exportReveal: 'export:reveal',
  aiGetState: 'ai:get-state',
  aiSaveProvider: 'ai:save-provider',
  aiRemoveProvider: 'ai:remove-provider',
  aiDisconnectProvider: 'ai:disconnect-provider',
  aiTestProvider: 'ai:test-provider',
  aiRefreshModels: 'ai:refresh-models',
  aiUpdatePreferences: 'ai:update-preferences',
  aiRunTurn: 'ai:run-turn',
  aiCancelTurn: 'ai:cancel-turn',
  aiListConversations: 'ai:conversations-list',
  aiLoadConversation: 'ai:conversation-load',
  aiSaveConversation: 'ai:conversation-save',
  aiRenameConversation: 'ai:conversation-rename',
  aiDeleteConversation: 'ai:conversation-delete',
  aiClearConversations: 'ai:conversations-clear',
  aiPickAttachments: 'ai:pick-attachments',
  aiListMcpServers: 'ai:mcp-list',
  aiSaveMcpServer: 'ai:mcp-save',
  aiRemoveMcpServer: 'ai:mcp-remove',
  aiConnectMcpServer: 'ai:mcp-connect',
  aiDisconnectMcpServer: 'ai:mcp-disconnect',
  aiTestMcpServer: 'ai:mcp-test',
  aiListMcpTools: 'ai:mcp-tools',
  aiCallMcpTool: 'ai:mcp-call'
} as const;

/** Channels the main process pushes to the renderer. */
export const IPC_EVENTS = {
  exportProgress: 'export:progress',
  aiTurn: 'ai:turn-event'
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface IpcContract {
  'project:create': { request: { name: string; location: string; canvas?: ProjectCanvas }; response: ProjectMetadata };
  'project:open': { request: { path?: string }; response: ProjectMetadata | null };
  'project:close': { request: undefined; response: void };
  'project:get-recent': { request: undefined; response: RecentProject[] };
  'project:remove-recent': { request: { projectId: string }; response: void };
  'project:select-directory': { request: undefined; response: string | null };
  'animation:load': { request: { sceneId: string }; response: AnimationDocument | null };
  'animation:save': { request: { sceneId: string; document: AnimationDocument }; response: void };
  'scenes:list': { request: undefined; response: SceneCollection };
  'scenes:create': { request: { name: string }; response: SceneCollection };
  'scenes:rename': { request: { sceneId: string; name: string }; response: SceneCollection };
  'scenes:delete': { request: { sceneId: string }; response: SceneCollection };
  'scenes:select': { request: { sceneId: string }; response: SceneCollection };
  'assets:list': { request: undefined; response: ProjectAsset[] };
  'assets:read-image': { request: { assetId: string }; response: string };
  'assets:import': { request: undefined; response: AssetImportResult };
  'assets:rename': { request: { assetId: string; newName: string }; response: ProjectAsset };
  'assets:delete': { request: { assetId: string }; response: void };
  'export:capabilities': { request: undefined; response: ExportCapabilities };
  'export:destination': { request: DestinationQuery; response: ExportDestination | null };
  'export:start': { request: ExportRequest; response: ExportResult };
  'export:cancel': { request: undefined; response: void };
  'export:reveal': { request: undefined; response: void };
  'ai:get-state': { request: undefined; response: AIState };
  'ai:save-provider': { request: SaveProviderInput; response: AIState };
  'ai:remove-provider': { request: { providerId: string }; response: AIState };
  'ai:disconnect-provider': { request: { providerId: string }; response: AIState };
  'ai:test-provider': { request: SaveProviderInput; response: { modelCount: number } };
  'ai:refresh-models': { request: { providerId: string }; response: AIState };
  'ai:update-preferences': { request: AIPreferences; response: AIState };
  'ai:run-turn': { request: TurnRequest; response: TurnResult };
  'ai:cancel-turn': { request: { requestId: string }; response: void };
  'ai:conversations-list': { request: undefined; response: ConversationSummary[] };
  'ai:conversation-load': { request: { id: string }; response: Conversation | null };
  'ai:conversation-save': { request: Conversation; response: void };
  'ai:conversation-rename': { request: { id: string; title: string }; response: void };
  'ai:conversation-delete': { request: { id: string }; response: void };
  'ai:conversations-clear': { request: undefined; response: number };
  'ai:pick-attachments': { request: undefined; response: AttachmentPickResult };
  'ai:mcp-list': { request: undefined; response: McpServerStatus[] };
  'ai:mcp-save': { request: SaveMcpServerInput; response: AIState };
  'ai:mcp-remove': { request: { serverId: string }; response: AIState };
  'ai:mcp-connect': { request: { serverId: string }; response: McpServerStatus };
  'ai:mcp-disconnect': { request: { serverId: string }; response: McpServerStatus | null };
  'ai:mcp-test': { request: { serverId: string }; response: McpServerStatus };
  'ai:mcp-tools': { request: undefined; response: McpToolInfo[] };
  'ai:mcp-call': { request: { serverId: string; tool: string; input: Record<string, unknown> }; response: McpCallResult };
}

export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request'];
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response'];

export const ALLOWED_IPC_CHANNELS: readonly IpcChannel[] = Object.values(IPC_CHANNELS);
