import type { IpcResult } from './errors';
import type { ToolWindowLayout } from './layout';
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
  TurnEvent,
  TurnRequest,
  TurnResult
} from '../ai/types';
import type { AnimationDocument } from './animation';
import type { AssetImportResult, ProjectAsset } from './assets';
import type {
  DestinationQuery,
  ExportCapabilities,
  ExportDestination,
  ExportProgress,
  ExportRequest,
  ExportResult
} from './export';
import type { ProjectCanvas, ProjectMetadata, RecentProject } from './project';
import type { SceneCollection } from './scenes';
import type { CopilotEvent, CopilotLogin, CopilotOutcome, CopilotRequest, CopilotStatus, CopilotToolResult } from '../ai/copilot';

/**
 * API exposed to the renderer by the preload script (`window.api.project`).
 * Every call resolves to an `IpcResult`; failures never reject.
 */
export interface ProjectAPI {
  createProject(name: string, location: string, canvas?: ProjectCanvas): Promise<IpcResult<ProjectMetadata>>;
  /**
   * Opens a project. When `path` is omitted the main process shows the native
   * directory dialog. Resolves to `null` when the user cancels the dialog.
   */
  openProject(path?: string): Promise<IpcResult<ProjectMetadata | null>>;
  getRecentProjects(): Promise<IpcResult<RecentProject[]>>;
  removeRecentProject(projectId: string): Promise<IpcResult<void>>;
  closeProject(): Promise<IpcResult<void>>;
  /** Native directory picker, used to choose a project location. `null` if cancelled. */
  selectDirectory(): Promise<IpcResult<string | null>>;
}

/**
 * Persistence of the animation content (frames, layers, drawings) of each
 * scene of the open project. The renderer never touches files; Project
 * Management owns storage.
 */
export interface AnimationAPI {
  /** Resolves to `null` when the scene has no stored animation yet. */
  loadAnimation(sceneId: string): Promise<IpcResult<AnimationDocument | null>>;
  saveAnimation(sceneId: string, document: AnimationDocument): Promise<IpcResult<void>>;
}

/**
 * Scenes of the open project (HU_00011). Every operation resolves to the
 * updated collection, so the renderer never has to guess the outcome.
 */
export interface ScenesAPI {
  listScenes(): Promise<IpcResult<SceneCollection>>;
  /** Creates a scene and makes it the active one. */
  createScene(name: string): Promise<IpcResult<SceneCollection>>;
  renameScene(sceneId: string, name: string): Promise<IpcResult<SceneCollection>>;
  /** Deletes a scene; when it was active, the main process picks the next active one. */
  deleteScene(sceneId: string): Promise<IpcResult<SceneCollection>>;
  selectScene(sceneId: string): Promise<IpcResult<SceneCollection>>;
}

/**
 * Project-wide asset management (HU_00005 §7). The renderer only works with
 * opaque asset ids; the main process owns every file path and file dialog.
 */
export interface AssetsAPI {
  listAssets(): Promise<IpcResult<ProjectAsset[]>>;
  readAssetImage(assetId: string): Promise<IpcResult<string>>;
  /** Shows the native file picker and copies the chosen files into the project. */
  importAssets(): Promise<IpcResult<AssetImportResult>>;
  /** Renames an asset. `newName` is the name without extension; the extension is preserved. */
  renameAsset(assetId: string, newName: string): Promise<IpcResult<ProjectAsset>>;
  deleteAsset(assetId: string): Promise<IpcResult<void>>;
}

/**
 * Frame and animation export (HU_00012). Output paths are chosen in native
 * dialogs owned by the main process; the renderer only refers to them by id.
 */
export interface ExportAPI {
  /** Formats whose encoder is available on this machine. */
  getCapabilities(): Promise<IpcResult<ExportCapabilities>>;
  /** Shows the native file or folder dialog. Resolves to `null` when cancelled. */
  chooseDestination(query: DestinationQuery): Promise<IpcResult<ExportDestination | null>>;
  /** Runs the export and resolves when it finished, failed or was cancelled. */
  startExport(request: ExportRequest): Promise<IpcResult<ExportResult>>;
  cancelExport(): Promise<IpcResult<void>>;
  /** Shows the output of the last successful export in the file manager. */
  revealOutput(): Promise<IpcResult<void>>;
  /** Subscribes to export progress; returns the unsubscribe function. */
  onProgress(listener: (progress: ExportProgress) => void): () => void;
}

/**
 * AI providers, conversations and MCP servers (HU_00014). Credentials are write-only: the main
 * process stores them and the renderer only ever sees a masked hint.
 */
export interface AIAPI {
  connectCopilot(providerId: string): Promise<IpcResult<CopilotStatus>>;
  getCopilotStatus(providerId: string): Promise<IpcResult<CopilotStatus>>;
  beginCopilotLogin(providerId: string): Promise<IpcResult<CopilotLogin>>;
  finishCopilotLogin(providerId: string): Promise<IpcResult<CopilotStatus>>;
  runCopilot(request: CopilotRequest): Promise<IpcResult<CopilotOutcome>>;
  respondCopilotTool(result: CopilotToolResult): Promise<IpcResult<void>>;
  cancelCopilot(requestId: string): Promise<IpcResult<void>>;
  onCopilotEvent(listener: (event: CopilotEvent) => void): () => void;
  getState(): Promise<IpcResult<AIState>>;
  saveProvider(input: SaveProviderInput): Promise<IpcResult<AIState>>;
  removeProvider(providerId: string): Promise<IpcResult<AIState>>;
  /** Forgets the stored key but keeps the connection. */
  disconnectProvider(providerId: string): Promise<IpcResult<AIState>>;
  /** Checks a configuration without saving it. */
  testProvider(input: SaveProviderInput): Promise<IpcResult<{ modelCount: number }>>;
  refreshModels(providerId: string): Promise<IpcResult<AIState>>;
  updatePreferences(preferences: AIPreferences): Promise<IpcResult<AIState>>;
  /** One model request. Text is streamed through `onTurnEvent` while it runs. */
  runTurn(request: TurnRequest): Promise<IpcResult<TurnResult>>;
  cancelTurn(requestId: string): Promise<IpcResult<void>>;
  onTurnEvent(listener: (event: TurnEvent) => void): () => void;
  listConversations(): Promise<IpcResult<ConversationSummary[]>>;
  loadConversation(id: string): Promise<IpcResult<Conversation | null>>;
  saveConversation(conversation: Conversation): Promise<IpcResult<void>>;
  renameConversation(id: string, title: string): Promise<IpcResult<void>>;
  deleteConversation(id: string): Promise<IpcResult<void>>;
  /** Deletes every stored conversation; resolves to how many were removed. */
  clearConversations(): Promise<IpcResult<number>>;
  /** Native file picker; the chosen files are validated and read by the main process. */
  pickAttachments(): Promise<IpcResult<AttachmentPickResult>>;
  listMcpServers(): Promise<IpcResult<McpServerStatus[]>>;
  saveMcpServer(input: SaveMcpServerInput): Promise<IpcResult<AIState>>;
  removeMcpServer(serverId: string): Promise<IpcResult<AIState>>;
  connectMcpServer(serverId: string): Promise<IpcResult<McpServerStatus>>;
  disconnectMcpServer(serverId: string): Promise<IpcResult<McpServerStatus | null>>;
  testMcpServer(serverId: string): Promise<IpcResult<McpServerStatus>>;
  listMcpTools(): Promise<IpcResult<McpToolInfo[]>>;
  callMcpTool(serverId: string, tool: string, input: Record<string, unknown>): Promise<IpcResult<McpCallResult>>;
}

/** Application UI preferences (not project data). */
export interface LayoutAPI {
  getLayout(): Promise<IpcResult<ToolWindowLayout>>;
  saveLayout(layout: ToolWindowLayout): Promise<IpcResult<void>>;
}

export interface AppAPI {
  project: ProjectAPI;
  animation: AnimationAPI;
  scenes: ScenesAPI;
  assets: AssetsAPI;
  export: ExportAPI;
  ai: AIAPI;
  layout: LayoutAPI;
}
