import type { AgentEvent, AgentOutcome, TurnInput } from './runtime';
import type { ToolCall } from './types';

export type CopilotConnectionState = 'not-connected' | 'connecting' | 'connected' | 'authentication-required' | 'missing-entitlement' | 'error' | 'disconnected';

export interface CopilotStatus {
  state: CopilotConnectionState;
  login: string | null;
  message: string;
}

export interface CopilotLogin {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

export interface CopilotRequest extends TurnInput {
  requestId: string;
  conversationId: string;
}

export type CopilotEvent =
  | { requestId: string; kind: 'event'; event: AgentEvent }
  | { requestId: string; kind: 'tool'; call: ToolCall };

export interface CopilotToolResult {
  requestId: string;
  callId: string;
  content: string;
  isError: boolean;
  images?: { mediaType: string; data: string }[];
}

export type CopilotOutcome = Pick<AgentOutcome, 'status' | 'error' | 'iterations' | 'toolCalls'>;