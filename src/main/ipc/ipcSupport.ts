import { AppError, toAppErrorInfo } from '@core/errors';
import { describeError, type Logger } from '@core/logger';
import type { IpcChannel, IpcResponse } from '@shared/ipc/channels';
import type { IpcResult } from '@shared/types/errors';

/** Minimal slice of Electron's `ipcMain` used here, so handlers are testable without Electron. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, payload?: unknown) => unknown): void;
}

export function invalidRequest(): AppError {
  return new AppError('INVALID_REQUEST', 'The request could not be processed.');
}

export function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw invalidRequest();
  }
  return payload as Record<string, unknown>;
}

export function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalidRequest();
  }
  return value;
}

/** Returns a `register` function that wraps every handler so failures become `IpcResult` errors. */
export function createRegistrar(ipc: IpcMainLike, logger: Logger) {
  return function register<C extends IpcChannel>(channel: C, handler: (request: unknown) => Promise<IpcResponse<C>> | IpcResponse<C>): void {
    ipc.handle(channel, async (_event, payload): Promise<IpcResult<IpcResponse<C>>> => {
      try {
        return { ok: true, value: await handler(payload) };
      } catch (error) {
        if (!(error instanceof AppError)) {
          logger.error(`Unexpected error in ${channel}`, describeError(error));
        }
        return { ok: false, error: toAppErrorInfo(error) };
      }
    });
  };
}
