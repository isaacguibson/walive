import type { AppErrorCode, AppErrorInfo } from '@shared/types/errors';

/**
 * Error raised by the application core. `message` is always safe to show to
 * end users; technical details live in `cause` and are only meant for logs.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
  }

  toInfo(): AppErrorInfo {
    return { code: this.code, message: this.message };
  }
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}

export function isPermissionError(error: unknown): boolean {
  return isNodeError(error) && (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EROFS');
}

/** Converts any thrown value into a user-safe error description. */
export function toAppErrorInfo(error: unknown): AppErrorInfo {
  if (error instanceof AppError) {
    return error.toInfo();
  }
  return { code: 'UNKNOWN', message: 'Something went wrong. Please try again.' };
}
