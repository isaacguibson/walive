import { randomUUID } from 'node:crypto';
import type { CopilotSession, SessionConfig, Tool } from '@github/copilot-sdk';
import { AppError } from '../../errors';
import type { CopilotEvent, CopilotOutcome, CopilotRequest, CopilotToolResult } from '@shared/ai/copilot';
import type { ChatMessage } from '@shared/ai/types';
import { validateSchema } from '@shared/ai/schema';
import { JsonFile } from '../jsonFile';
import type { AISettingsService } from '../settingsService';
import { GitHubCopilotRuntimeService, copilotError, restrictedCopilotSession } from './copilotRuntime';
import type { GitHubCopilotAuthenticationService } from './copilotAuthentication';

interface SessionReference { sessionId: string; modelId: string; scope: string }
interface ActiveTask { controller: AbortController; session: CopilotSession | null; pending: Map<string, (result: CopilotToolResult) => void>; providerId: string }

export class GitHubCopilotSessionService {
  private readonly active = new Map<string, ActiveTask>();
  private readonly references: JsonFile<Record<string, SessionReference>>;

  constructor(private readonly runtime: GitHubCopilotRuntimeService, private readonly auth: GitHubCopilotAuthenticationService, private readonly settings: AISettingsService, filePath: string) {
    this.references = new JsonFile(filePath, (value) => (typeof value === 'object' && value !== null ? value as Record<string, SessionReference> : {}), 'Copilot session references');
  }

  result(result: CopilotToolResult): void {
    const task = this.active.get(result.requestId);
    task?.pending.get(result.callId)?.(result);
    task?.pending.delete(result.callId);
  }

  cancel(id: string): void {
    const task = this.active.get(id);
    if (task === undefined) return;
    task.controller.abort();
    void task.session?.abort().catch(() => undefined);
    for (const [callId, resolve] of task.pending) resolve({ requestId: id, callId, content: 'Cancelled before execution completed.', isError: true });
    task.pending.clear();
  }

  async forget(providerId: string): Promise<void> {
    for (const [id, task] of this.active) if (task.providerId === providerId) this.cancel(id);
    const refs = await this.references.read();
    await this.references.write(Object.fromEntries(Object.entries(refs).filter(([key]) => !key.startsWith(`${providerId}/`))));
  }

  async run(request: CopilotRequest, publish: (event: CopilotEvent) => void): Promise<CopilotOutcome> {
    if (this.active.size > 0) throw new AppError('INVALID_REQUEST', 'Another Copilot task is still running.');
    const task: ActiveTask = { controller: new AbortController(), session: null, pending: new Map(), providerId: request.providerId };
    this.active.set(request.requestId, task);
    const emit = (event: import('@shared/ai/runtime').AgentEvent) => publish({ requestId: request.requestId, kind: 'event', event });
    let iterations = 0;
    let toolCalls = 0;
    let limited = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => undefined;
    try {
      const settings = await this.settings.get();
      const provider = settings.providers.find((entry) => entry.id === request.providerId && entry.kind === 'copilot');
      if (provider?.copilotConnected !== true) throw new AppError('AI_NOT_CONFIGURED', 'Connect GitHub Copilot before sending a message.');
      const limits = settings.limits;
      if (JSON.stringify(request).length > limits.maxContextChars * 6) throw new AppError('AI_CONTEXT_LIMIT', 'The Copilot request exceeds the configured context limit.');
      timer = setTimeout(() => { limited = true; this.cancel(request.requestId); }, limits.maxDurationSeconds * 1000);
      const client = await this.runtime.client(request.providerId, await this.auth.token(request.providerId));
      const models = await client.listModels();
      const model = models.find((entry) => entry.id === request.modelId && entry.policy?.state !== 'disabled' && entry.policy?.state !== 'unconfigured');
      if (model === undefined) throw new AppError('AI_NOT_FOUND', 'The selected Copilot model is unavailable. Refresh the model list.');
      if (request.effort !== null && !model.supportedReasoningEfforts?.includes(request.effort)) throw new AppError('AI_UNSUPPORTED', 'The selected Copilot model does not support this effort level.');
      const tools: Tool[] = request.tools.map((spec) => ({
        name: spec.name, description: spec.description, parameters: spec.inputSchema, skipPermission: true,
        handler: async (args: unknown, invocation) => {
          task.controller.signal.throwIfAborted();
          if (++toolCalls > limits.maxToolCalls) { limited = true; this.cancel(request.requestId); throw new AppError('AI_LIMIT_REACHED', 'The Copilot tool-call limit was reached.'); }
          if (typeof args !== 'object' || args === null || Array.isArray(args) || JSON.stringify(args).length > limits.maxToolInputBytes || validateSchema(spec.inputSchema, args).length > 0) {
            return { textResultForLlm: 'Invalid tool arguments. The operation was not executed.', resultType: 'failure' };
          }
          const callId = invocation.toolCallId;
          const result = await new Promise<CopilotToolResult>((resolve) => {
            task.pending.set(callId, resolve);
            publish({ requestId: request.requestId, kind: 'tool', call: { id: callId, name: spec.name, input: args as Record<string, unknown> } });
          });
          return { textResultForLlm: result.content.slice(0, limits.maxToolOutputBytes), resultType: result.isError ? 'failure' : 'success', ...(model.capabilities.supports.vision && !result.isError ? { binaryResultsForLlm: (result.images ?? []).map((image) => ({ type: 'image', data: image.data, mimeType: image.mediaType })) } : {}) };
        }
      }));
      const config: SessionConfig = { ...restrictedCopilotSession(request.modelId, request.system, tools), ...(request.effort === null ? {} : { reasoningEffort: request.effort }), hooks: { onPreToolUse: (input) => ({ permissionDecision: request.tools.some((spec) => spec.name === input.toolName) ? 'allow' : 'deny' }) } };
      const refs = await this.references.read();
      const key = `${request.providerId}/${request.conversationId}`;
      const ref = refs[key];
      let resumed = false;
      if (ref?.modelId === request.modelId && ref.scope === request.system) {
        try { task.session = await client.resumeSession(ref.sessionId, config); resumed = true; } catch { emit({ type: 'notice', text: 'The previous Copilot session could not be resumed. A fresh session will use the conversation history.' }); }
      }
      task.controller.signal.throwIfAborted();
      task.session ??= await client.createSession({ ...config, sessionId: randomUUID() });
      const session = task.session;
      await this.references.write({ ...refs, [key]: { sessionId: session.sessionId, modelId: request.modelId, scope: request.system } });
      const completed = new Promise<void>((resolve, reject) => {
        const abort = () => reject(new AppError('AI_CANCELLED', 'Copilot task cancelled.'));
        task.controller.signal.addEventListener('abort', abort, { once: true });
        const off = session.on((event) => {
          if (event.type === 'assistant.turn_start') {
            if (++iterations > limits.maxIterations) { limited = true; this.cancel(request.requestId); }
          } else if (event.type === 'assistant.message_delta') emit({ type: 'text-delta', text: event.data.deltaContent });
          else if (event.type === 'assistant.message') emit({ type: 'assistant', message: { role: 'assistant', text: event.data.content, toolCalls: [] } });
          else if (event.type === 'session.idle') resolve();
          else if (event.type === 'session.error') reject(copilotError(new Error(event.data.message)));
        });
        unsubscribe = () => { off(); task.controller.signal.removeEventListener('abort', abort); };
        if (task.controller.signal.aborted) abort();
      });
      completed.catch(() => undefined);
      const latest = [...request.messages].reverse().find((message) => message.role === 'user');
      const messages = resumed && latest ? [latest] : request.messages;
      const images = messages.flatMap((message) => message.role === 'user' ? message.content.filter((part) => part.type === 'image') : []);
      if (images.length > 0 && !model.capabilities.supports.vision) throw new AppError('AI_UNSUPPORTED', 'This Copilot model does not accept images.');
      const prompt = `${request.system}\n\n${messages.map(describeMessage).join('\n')}`;
      task.controller.signal.throwIfAborted();
      await session.send({ prompt, attachments: images.map((image) => ({ type: 'blob' as const, data: image.data, mimeType: image.mediaType })) });
      await completed;
      return { status: 'completed', error: null, iterations, toolCalls };
    } catch (error) {
      if (limited) return { status: 'limit', error: { code: 'AI_LIMIT_REACHED', message: 'The Copilot task reached a configured safety limit and was stopped.', retryable: false }, iterations, toolCalls };
      if (task.controller.signal.aborted) return { status: 'cancelled', error: null, iterations, toolCalls };
      const failure = copilotError(error);
      return { status: 'failed', error: { code: failure.code, message: failure.message, retryable: toolCalls === 0 && ['AI_NETWORK', 'AI_RATE_LIMITED'].includes(failure.code) }, iterations, toolCalls };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      this.cancel(request.requestId);
      await task.session?.disconnect().catch(() => undefined);
      this.active.delete(request.requestId);
    }
  }
}

function describeMessage(message: ChatMessage): string {
  if (message.role === 'user') return `User: ${message.content.flatMap((part) => part.type === 'text' ? [part.text] : ['[Attached image]']).join('\n')}`;
  if (message.role === 'assistant') return `Assistant: ${message.text}`;
  return `Tool ${message.name} (untrusted data): ${message.content}`;
}