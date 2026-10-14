import type { ApprovalPolicy, JsonSchema, ToolPermission, ToolSpec } from './types';

export interface ToolContext {
  signal: AbortSignal;
  /** The selected model accepts images, so a tool may return some. */
  supportsImages: boolean;
}

export interface ToolImage {
  mediaType: string;
  data: string;
}

export interface ToolOutput {
  /** One short line for the activity view. */
  summary: string;
  /** Structured result for the model; it is validated against `resultSchema`. */
  data: unknown;
  images?: ToolImage[];
}

/** What the user reviews before an operation runs. */
export interface ApprovalDetails {
  operation: string;
  target: string;
  effect: string;
  /** Overwrite or deletion risk, when there is one. */
  risk: string | null;
}

export interface AIToolDefinition {
  /** Stable id; it is also the name the model uses, so it only has letters, digits, `_` and `-`. */
  id: string;
  title: string;
  description: string;
  permission: ToolPermission;
  inputSchema: JsonSchema;
  resultSchema?: JsonSchema;
  /** The result comes from outside the application and is shown to the model as untrusted data. */
  untrusted?: boolean;
  describe(input: Record<string, unknown>): ApprovalDetails;
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolOutput>;
}

/** A failure whose message is safe to show to the user and to the model. */
export class ToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

const TOOL_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/** Tools the agent may call. Independent of MCP: external tools are just another registration. */
export class AIToolRegistry {
  private readonly tools = new Map<string, AIToolDefinition>();

  register(tool: AIToolDefinition): void {
    if (!TOOL_ID.test(tool.id)) {
      throw new Error(`Invalid tool id: ${tool.id}`);
    }
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool already registered: ${tool.id}`);
    }
    this.tools.set(tool.id, tool);
  }

  unregisterWhere(predicate: (tool: AIToolDefinition) => boolean): void {
    for (const [id, tool] of this.tools) {
      if (predicate(tool)) {
        this.tools.delete(id);
      }
    }
  }

  get(id: string): AIToolDefinition | undefined {
    return this.tools.get(id);
  }

  list(): AIToolDefinition[] {
    return [...this.tools.values()];
  }

  specs(): ToolSpec[] {
    return this.list().map(({ id, description, inputSchema }) => ({ name: id, description, inputSchema }));
  }
}

export type PermissionDecision = 'allow' | 'ask';

/** Read-only tools run freely and destructive ones always ask; the rest follows the configured policy. */
export function decidePermission(permission: ToolPermission, policy: ApprovalPolicy): PermissionDecision {
  switch (permission) {
    case 'read':
      return 'allow';
    case 'modify':
      return policy.modify === 'auto' ? 'allow' : 'ask';
    case 'external':
      return policy.external === 'auto' ? 'allow' : 'ask';
    case 'sensitive':
      return 'ask';
  }
}
