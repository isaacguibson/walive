import { AIClientError } from '@shared/ai/errors';
import type { AITurnClient } from '@shared/ai/runtime';
import type { AIAPI } from '@shared/types/api';
import type { AgentOutcome } from '@shared/ai/runtime';

/** Runs model requests in the main process, where the credentials live, and streams their text back. */
export function createTurnClient(api: AIAPI, conversationId: () => string = () => crypto.randomUUID()): AITurnClient {
  return {
    async runAgent(input, emit, execute, signal): Promise<AgentOutcome> {
      signal.throwIfAborted();
      const requestId = crypto.randomUUID();
      const toolController = new AbortController();
      let toolQueue = Promise.resolve();
      const unsubscribe = api.onCopilotEvent((event) => {
        if (event.requestId !== requestId || signal.aborted) return;
        if (event.kind === 'event') emit(event.event);
        else {
          toolQueue = toolQueue.then(async () => {
            if (signal.aborted) return;
            emit({ type: 'assistant', message: { role: 'assistant', text: '', toolCalls: [event.call] } });
            const result = await execute(event.call, toolController.signal);
            await api.respondCopilotTool({ requestId, callId: event.call.id, content: result.content, isError: result.isError, ...(result.images === undefined ? {} : { images: result.images }) });
          }).catch(() => { void api.cancelCopilot(requestId); });
        }
      });
      let cancel = () => undefined;
      const aborted = new Promise<AgentOutcome>((resolve) => {
        cancel = () => { toolController.abort(); void api.cancelCopilot(requestId); resolve({ status: 'cancelled', error: null, iterations: 0, toolCalls: 0, changes: [] }); };
        signal.addEventListener('abort', cancel, { once: true });
      });
      try {
        const outcome = api.runCopilot({ ...input, requestId, conversationId: conversationId() }).then((result): AgentOutcome => {
          if (!result.ok) throw new AIClientError(result.error.code, result.error.message);
          return { ...result.value, changes: [] };
        });
        const result = await Promise.race([outcome, aborted]);
        if (result.status !== 'completed') toolController.abort();
        await toolQueue;
        return result;
      } finally { toolController.abort(); signal.removeEventListener('abort', cancel); unsubscribe(); }
    },
    async runTurn(input, onDelta, signal) {
      if (signal.aborted) {
        throw new AIClientError('AI_CANCELLED', 'The request was cancelled.');
      }
      const requestId = crypto.randomUUID();
      const unsubscribe = api.onTurnEvent((event) => {
        if (event.requestId === requestId) {
          onDelta(event.delta);
        }
      });
      // Cancelling must not wait for the main process to answer.
      let onAbort = (): void => undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => {
          void api.cancelTurn(requestId);
          reject(new AIClientError('AI_CANCELLED', 'The request was cancelled.'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        const result = await Promise.race([api.runTurn({ requestId, ...input }), aborted]);
        if (!result.ok) {
          throw new AIClientError(result.error.code, result.error.message);
        }
        return result.value;
      } finally {
        signal.removeEventListener('abort', onAbort);
        unsubscribe();
      }
    }
  };
}
