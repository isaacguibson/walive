import { AppError } from '../../errors';
import type { FetchLike } from './adapter';

const MAX_ERROR_CHARS = 200;

/** Removes every occurrence of the secrets from a text that may be shown or logged. */
export function redact(text: string, secrets: (string | null)[]): string {
  return secrets.reduce<string>((result, secret) => (secret === null || secret.length < 4 ? result : result.split(secret).join('[redacted]')), text);
}

function providerMessage(body: string, secrets: (string | null)[]): string {
  let message = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const error = parsed.error;
    message = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : typeof parsed.message === 'string' ? parsed.message : '';
  } catch {
    message = '';
  }
  return redact(message, secrets).slice(0, MAX_ERROR_CHARS);
}

/** Maps an HTTP failure to a normalized, user-safe error. */
export function errorForStatus(status: number, body: string, secrets: (string | null)[]): AppError {
  const detail = providerMessage(body, secrets);
  const suffix = detail === '' ? '' : ` (${detail})`;
  if (status === 401 || status === 403) {
    return new AppError('AI_AUTH_FAILED', `The provider rejected the credentials${suffix}. Check the API key and its permissions.`);
  }
  if (status === 404) {
    return new AppError('AI_NOT_FOUND', `The provider could not find the requested model or endpoint${suffix}.`);
  }
  if (status === 429) {
    return new AppError('AI_RATE_LIMITED', `The provider rate limit was reached${suffix}. Try again in a moment.`);
  }
  if (/context|too long|too large|maximum.*tokens/i.test(detail)) {
    return new AppError('AI_CONTEXT_LIMIT', `The request is larger than the model allows${suffix}.`);
  }
  if (status === 400 || status === 422) {
    return new AppError('AI_UNSUPPORTED', `The provider could not process the request${suffix}.`);
  }
  return new AppError('AI_PROVIDER_ERROR', `The provider reported an error (${status})${suffix}.`);
}

/** Sends a request and converts network failures, cancellation and error statuses into `AppError`s. */
export async function send(fetchImpl: FetchLike, url: string, init: RequestInit, secrets: (string | null)[], signal: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal });
  } catch (error) {
    if (signal.aborted) {
      throw new AppError('AI_CANCELLED', 'The request was cancelled.');
    }
    throw new AppError('AI_NETWORK', 'The provider could not be reached. Check the connection and the endpoint.', { cause: error });
  }
  if (!response.ok) {
    throw errorForStatus(response.status, await response.text().catch(() => ''), secrets);
  }
  return response;
}

/** Yields the `data:` payload of every server-sent event; a broken stream rejects instead of ending quietly. */
export async function* readSse(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (response.body === null) {
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal.aborted) {
          throw new AppError('AI_CANCELLED', 'The request was cancelled.');
        }
        throw new AppError('AI_NETWORK', 'The connection to the provider was interrupted.', { cause: error });
      }
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
      for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
        const data = buffer
          .slice(0, end)
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        buffer = buffer.slice(end + 2);
        if (data !== '') {
          yield data;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseToolInput(raw: string): Record<string, unknown> | null {
  if (raw.trim() === '') {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('AI_PROVIDER_ERROR', 'The provider sent a response that could not be read.');
  }
}
