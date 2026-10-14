import type { ManualModel, ModelInfo, ProviderDescriptor, ToolSpec, TurnResult, ChatMessage, EffortLevel } from '@shared/ai/types';

export interface ProviderConnection {
  providerId: string;
  baseUrl: string;
  apiKey: string | null;
  manualModels: ManualModel[];
}

export interface TurnParams {
  modelId: string;
  effort: EffortLevel | null;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
}

/**
 * The contract every provider implements. Request and response formats of a provider stay inside
 * its adapter; the rest of the application only sees these normalized types.
 */
export interface AIProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  /** Rejects with an `AppError` describing what is wrong with the connection. */
  validate(connection: ProviderConnection, signal: AbortSignal): Promise<void>;
  listModels(connection: ProviderConnection, signal: AbortSignal): Promise<ModelInfo[]>;
  runTurn(connection: ProviderConnection, params: TurnParams, onDelta: (text: string) => void, signal: AbortSignal): Promise<TurnResult>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
