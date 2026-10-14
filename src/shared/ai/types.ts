/**
 * Serializable AI contracts shared by the main process (providers, secrets, MCP) and the renderer
 * (agent runtime and workspace). Nothing here depends on a specific provider or on Node.js.
 */

// ---- Providers and models -------------------------------------------------

export type ProviderKind = 'openai' | 'anthropic' | 'openai-compatible' | 'copilot';

export type EffortLevel = 'low' | 'medium' | 'high' | 'max';
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'max'];

/** A capability is only `yes` or `no` with evidence; everything else stays `unknown`. */
export type Support = 'yes' | 'no' | 'unknown';

export type ModelSource = 'provider' | 'catalog' | 'manual';

export interface ModelCapabilities {
  image: Support;
  tools: Support;
  streaming: Support;
  /** Effort levels the model accepts; empty when it has no configurable effort. */
  efforts: EffortLevel[];
  contextWindow: number | null;
}

export interface ModelInfo {
  providerId: string;
  id: string;
  displayName: string;
  /** Where the capabilities come from: provider metadata, the built-in catalog or the user. */
  source: ModelSource;
  capabilities: ModelCapabilities;
  available: boolean;
}

/** A model the user declares when the provider cannot list it. */
export interface ManualModel {
  id: string;
  displayName: string;
  image: boolean;
  tools: boolean;
  efforts: EffortLevel[];
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  copilotConnected?: boolean;
  oauthClientId?: string;
  baseUrl: string | null;
  /** Masked key (for example `••••abcd`), or `null` when none is stored. The key itself never leaves the main process. */
  credentialHint: string | null;
  manualModels: ManualModel[];
}

export interface ProviderDescriptor {
  kind: ProviderKind;
  label: string;
  /** What the user needs for this provider (API key, entitlement, endpoint). */
  authHelp: string;
  needsApiKey: boolean;
  customEndpoint: 'none' | 'optional' | 'required';
  defaultBaseUrl: string | null;
  available: boolean;
  unavailableReason: string | null;
}

/** Input to create or update a provider. `apiKey: null` keeps the stored key. */
export interface SaveProviderInput {
  id: string | null;
  kind: ProviderKind;
  name: string;
  oauthClientId?: string;
  baseUrl: string | null;
  apiKey: string | null;
  manualModels: ManualModel[];
}

// ---- Settings -------------------------------------------------------------

export interface AgentLimits {
  maxIterations: number;
  maxToolCalls: number;
  maxDurationSeconds: number;
  maxToolInputBytes: number;
  maxToolOutputBytes: number;
  maxAttachmentBytes: number;
  maxContextChars: number;
}

export interface ApprovalPolicy {
  /** Reversible edits inside the open project. */
  modify: 'auto' | 'ask';
  /** External services such as MCP servers. */
  external: 'auto' | 'ask';
}

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

export interface AISettings {
  providers: ProviderConfig[];
  selection: ModelSelection | null;
  /** Preferred effort per `providerId/modelId`. */
  efforts: Record<string, EffortLevel>;
  limits: AgentLimits;
  approval: ApprovalPolicy;
  mcpServers: McpServerConfig[];
}

export interface AIPreferences {
  selection?: ModelSelection | null;
  efforts?: Record<string, EffortLevel>;
  limits?: AgentLimits;
  approval?: ApprovalPolicy;
}

export const DEFAULT_LIMITS: AgentLimits = {
  maxIterations: 12,
  maxToolCalls: 40,
  maxDurationSeconds: 300,
  maxToolInputBytes: 32_000,
  maxToolOutputBytes: 32_000,
  maxAttachmentBytes: 5 * 1024 * 1024,
  maxContextChars: 240_000
};

export const DEFAULT_APPROVAL: ApprovalPolicy = { modify: 'auto', external: 'ask' };

/** Everything the settings screens and the model selector need, in one snapshot. */
export interface AIState {
  settings: AISettings;
  descriptors: ProviderDescriptor[];
  models: ModelInfo[];
}

export function effortKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

// ---- Conversation -----------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments, or `null` when the model sent something that is not a JSON object. */
  input: Record<string, unknown> | null;
}

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string };

export type ChatMessage =
  | { role: 'user'; content: ContentPart[] }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError: boolean };

export type JsonSchema = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface TurnRequest {
  requestId: string;
  providerId: string;
  modelId: string;
  effort: EffortLevel | null;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
}

export type StopReason = 'end' | 'tool_calls' | 'length' | 'other';

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
}

/** Streamed while a turn is running. */
export interface TurnEvent {
  requestId: string;
  delta: string;
}

// ---- Attachments ---------------------------------------------------------------

export interface AttachmentPayload {
  id: string;
  name: string;
  mediaType: string;
  kind: 'image' | 'text';
  size: number;
  /** Base64 for images, UTF-8 text otherwise. */
  data: string;
}

export interface AttachmentInfo {
  name: string;
  kind: 'image' | 'text';
  size: number;
}

export interface AttachmentPickResult {
  attachments: AttachmentPayload[];
  /** Files that were not attached, with the reason. */
  rejected: { name: string; reason: string }[];
}

// ---- Stored conversations --------------------------------------------------------

export type ToolStatus = 'running' | 'awaiting-approval' | 'completed' | 'failed' | 'denied' | 'cancelled';

export type ToolPermission = 'read' | 'modify' | 'external' | 'sensitive';

export type NoticeLevel = 'info' | 'completed' | 'cancelled' | 'error';

export type ConversationEntry =
  | { id: string; at: string; kind: 'user'; message: Extract<ChatMessage, { role: 'user' }>; attachments: AttachmentInfo[] }
  | { id: string; at: string; kind: 'assistant'; message: Extract<ChatMessage, { role: 'assistant' }> }
  | {
      id: string;
      at: string;
      kind: 'tool';
      callId: string;
      name: string;
      title: string;
      permission: ToolPermission;
      status: ToolStatus;
      summary: string;
      /** What the model saw, present once the call finished. */
      message: Extract<ChatMessage, { role: 'tool' }> | null;
    }
  | { id: string; at: string; kind: 'notice'; level: NoticeLevel; text: string; retryable: boolean };

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  providerId: string | null;
  modelId: string | null;
  entries: ConversationEntry[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  providerId: string | null;
  modelId: string | null;
  entryCount: number;
}

// ---- MCP ---------------------------------------------------------------------------

export type McpTransportConfig = { transport: 'stdio'; command: string; args: string[] } | { transport: 'http'; url: string };

export type McpServerConfig = {
  id: string;
  name: string;
  enabled: boolean;
  /** The user explicitly allowed this server to start or be contacted. */
  trusted: boolean;
  /** Masked bearer token of a remote server. */
  credentialHint: string | null;
} & McpTransportConfig;

export type SaveMcpServerInput = {
  id: string | null;
  name: string;
  enabled: boolean;
  trusted: boolean;
  /** `null` keeps the stored token. */
  authToken: string | null;
} & McpTransportConfig;

export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpToolInfo {
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface McpServerStatus {
  id: string;
  state: McpConnectionState;
  error: string | null;
  /** The exact command that would be launched, for local servers. */
  commandLine: string | null;
  tools: McpToolInfo[];
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}
