export interface Logger {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

export const consoleLogger: Logger = {
  info: (message, details) => console.info(`[info] ${message}`, details ?? ''),
  warn: (message, details) => console.warn(`[warn] ${message}`, details ?? ''),
  error: (message, details) => console.error(`[error] ${message}`, details ?? '')
};

/** Extracts a loggable summary of an error without leaking it to the UI. */
export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    const cause = error.cause instanceof Error ? error.cause.message : undefined;
    return { error: error.message, code, cause };
  }
  return { error: String(error) };
}
