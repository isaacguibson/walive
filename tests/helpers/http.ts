import { vi } from 'vitest';
import type { FetchLike } from '@core/ai/providers/adapter';

const encoder = new TextEncoder();

/** A server-sent-events response whose bytes are cut at `chunkSize`, to exercise events split across reads. */
export function sse(events: unknown[], options: { chunkSize?: number; status?: number } = {}): Response {
  const body = events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
  const bytes = encoder.encode(body);
  const size = options.chunkSize ?? bytes.length;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += size) {
        controller.enqueue(bytes.slice(offset, offset + size));
      }
      controller.close();
    }
  });
  return new Response(stream, { status: options.status ?? 200, headers: { 'content-type': 'text/event-stream' } });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch replacement that answers from a queue and remembers every request. */
export function fakeFetch(...responses: (Response | Error | ((request: RecordedRequest, signal: AbortSignal | undefined) => Promise<Response>))[]) {
  const requests: RecordedRequest[] = [];
  const queue = [...responses];
  const fetchLike: FetchLike = vi.fn(async (url, init) => {
    const request: RecordedRequest = {
      url,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    };
    requests.push(request);
    const next = queue.shift();
    if (next === undefined) {
      throw new Error(`Unexpected request to ${url}`);
    }
    if (next instanceof Error) {
      throw next;
    }
    return typeof next === 'function' ? next(request, init.signal ?? undefined) : next;
  });
  return { fetch: fetchLike, requests };
}

/** Never answers until the request is aborted, like a slow provider. */
export function hanging(): (request: RecordedRequest, signal: AbortSignal | undefined) => Promise<Response> {
  return (_request, signal) =>
    new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
}
