import { AIClientError } from '@shared/ai/errors';
import type { AITurnClient } from '@shared/ai/runtime';
import type { AIAPI } from '@shared/types/api';

/** Runs model requests in the main process, where the credentials live, and streams their text back. */
export function createTurnClient(api: AIAPI): AITurnClient {
  return {
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
