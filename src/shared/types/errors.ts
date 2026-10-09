export const APP_ERROR_CODES = [
  'INVALID_NAME',
  'INVALID_LOCATION',
  'LOCATION_NOT_WRITABLE',
  'DIRECTORY_NOT_EMPTY',
  'PROJECT_ALREADY_EXISTS',
  'NOT_A_PROJECT',
  'INVALID_PROJECT_FILE',
  'INVALID_PROJECT_ID',
  'INVALID_PROJECT_NAME',
  'UNSUPPORTED_FORMAT_VERSION',
  'MISSING_DIRECTORIES',
  'PROJECT_UNAVAILABLE',
  'NO_PROJECT_OPEN',
  'PERMISSION_DENIED',
  'WRITE_FAILED',
  'STATE_READ_FAILED',
  'STATE_WRITE_FAILED',
  'INVALID_ANIMATION_DATA',
  'INVALID_REQUEST',
  'IPC_FAILURE',
  'UNKNOWN'
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/** Serializable, user-safe error. Never contains stack traces or raw filesystem errors. */
export interface AppErrorInfo {
  code: AppErrorCode;
  message: string;
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppErrorInfo };
