import type { AppErrorCode } from '../types/errors';

const RETRYABLE: readonly AppErrorCode[] = ['AI_RATE_LIMITED', 'AI_NETWORK', 'AI_PROVIDER_ERROR'];

/** Failure of a model request, normalized across providers. */
export class AIClientError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = 'AIClientError';
    this.code = code;
  }

  get retryable(): boolean {
    return RETRYABLE.includes(this.code);
  }
}

export function isRetryableCode(code: AppErrorCode): boolean {
  return RETRYABLE.includes(code);
}
