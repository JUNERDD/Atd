import { createStream } from '../../../runtime/channel.mjs';
import { fromWire, toWire } from '../../../runtime/wire.mjs';
import type { AppError, AppStreamLine } from '../../contracts.ts';
import type { ApiMap, BackendDefinition, StreamHandle } from '../server/types.ts';

/** A failed api call: the backend's or the service's `{code, message}`, with the HTTP status. */
export class AppApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(error: AppError, status: number) {
    super(error.message);
    this.name = 'AppApiError';
    this.code = error.code;
    this.status = status;
  }
}

type Returned<F> = F extends (...args: never[]) => infer R ? R : never;
type Settled<F> = Awaited<Returned<F>>;
/** What an api function takes as input. */
export type ApiInput<F> = F extends (input: infer I, ...rest: never[]) => unknown ? I : never;
/** What `api.call` resolves to: the value, or every chunk of a streaming function. */
export type ApiCallResult<F> = Settled<F> extends AsyncIterable<infer C> ? C[] : Settled<F>;
/** A chunk of `api.stream`. */
export type ApiStreamChunk<F> = Settled<F> extends AsyncIterable<infer C> ? C : never;
/** The result of `api.stream`: a generator's return value, or a plain function's value. */
export type ApiStreamResult<F> =
  Returned<F> extends AsyncGenerator<unknown, infer R>
    ? R
    : Settled<F> extends AsyncIterable<unknown>
      ? undefined
      : Settled<F>;

export interface CallOptions {
  signal?: AbortSignal;
}
type CallArgs<I> = unknown extends I
  ? [input?: I, options?: CallOptions]
  : undefined extends I
    ? [input?: I, options?: CallOptions]
    : [input: I, options?: CallOptions];

type ApiOf<Backend> = Backend extends BackendDefinition<infer Api> ? Api : never;
/** The api of a backend whose type the page does not import: any name, any input. */
type UntypedApi = Record<string, (input: unknown) => unknown>;

export interface AppApi<Api extends ApiMap> {
  /** Calls a backend function and resolves with its result. */
  call<K extends keyof Api & string>(
    name: K,
    ...args: CallArgs<ApiInput<Api[K]>>
  ): Promise<ApiCallResult<Api[K]>>;
  /** Calls a backend function and streams its chunks; `result` settles with its final value. */
  stream<K extends keyof Api & string>(
    name: K,
    ...args: CallArgs<ApiInput<Api[K]>>
  ): StreamHandle<ApiStreamChunk<Api[K]>, ApiStreamResult<Api[K]>>;
}

/**
 * Binary values reach the service only as bytes inside a string body: WebKit delivers empty
 * bodies for Blob and File (T1), so they are read with `arrayBuffer()` first.
 */
async function readBlobs(value: unknown): Promise<unknown> {
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (Array.isArray(value)) return Promise.all(value.map(readBlobs));
  if (value !== null && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    if (value instanceof ArrayBuffer || value instanceof Date) return value;
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, entry]) => [key, await readBlobs(entry)] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

async function post(
  name: string,
  input: unknown,
  signal: AbortSignal | undefined,
  stream: boolean,
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    // The shell forwards same-origin `/api` posts only with this header (CSRF guard).
    'x-ai-relay': '1',
  };
  // Mirrors `APP_STREAM_CONTENT_TYPE` (a value import would bundle the contract schemas).
  if (stream) headers.accept = 'application/x-ndjson';
  const response = await fetch(`/api/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(toWire(await readBlobs(input ?? null))),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await responseError(response);
  return response;
}

async function responseError(response: Response): Promise<AppApiError> {
  const fallback = { code: 'internal', message: `Request failed with status ${response.status}.` };
  try {
    const body: unknown = await response.json();
    return new AppApiError(readAppError(body) ?? fallback, response.status);
  } catch {
    return new AppApiError(fallback, response.status);
  }
}

function readAppError(body: unknown): AppError | null {
  if (body === null || typeof body !== 'object' || !('error' in body)) return null;
  const { error } = body;
  if (error === null || typeof error !== 'object') return null;
  const code: unknown = Reflect.get(error, 'code');
  const message: unknown = Reflect.get(error, 'message');
  return typeof code === 'string' && typeof message === 'string' ? { code, message } : null;
}

function parseLine(line: string): AppStreamLine {
  const parsed: unknown = JSON.parse(line);
  if (parsed !== null && typeof parsed === 'object' && 'type' in parsed) {
    if (parsed.type === 'chunk' && 'data' in parsed) return { type: 'chunk', data: parsed.data };
    if (parsed.type === 'result') return { type: 'result', value: Reflect.get(parsed, 'value') };
    const error = readAppError(parsed);
    if (parsed.type === 'error' && error) return { type: 'error', error };
  }
  throw new Error(`Unexpected stream line: ${line.slice(0, 200)}`);
}

/** Reads an NDJSON body line by line into the sink until its result or error line. */
async function pump(
  response: Response,
  sink: { push(chunk: unknown): void; finish(value: unknown): void; fail(error: unknown): void },
) {
  const body = response.body;
  if (!body) throw new Error('The streaming response has no body.');
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += value ?? '';
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;
      const parsed = parseLine(line);
      if (parsed.type === 'chunk') sink.push(fromWire(parsed.data));
      else if (parsed.type === 'result') return sink.finish(fromWire(parsed.value));
      else return sink.fail(new AppApiError(parsed.error, response.status));
    }
    if (done) throw new Error('The stream ended without a result.');
  }
}

/**
 * The typed api of an app's backend. Pass the backend's type for checked names, inputs and results:
 * `const api = createApi<typeof backend>()` with `import type backend from '../../server/index.ts'`.
 */
export function createApi<
  Backend extends BackendDefinition = BackendDefinition<UntypedApi>,
>(): AppApi<ApiOf<Backend>> {
  return {
    async call(name, ...[input, options]) {
      const response = await post(name, input, options?.signal, false);
      // The response is the backend function's JSON result; its type is the backend's contract.
      return fromWire(await response.json()) as never;
    },
    stream(name, ...[input, options]) {
      const controller = new AbortController();
      options?.signal?.addEventListener('abort', () => controller.abort(), { once: true });
      const sink = createStream<never, never>(() => controller.abort());
      post(name, input, controller.signal, true)
        .then((response) => pump(response, sink))
        .catch((error: unknown) => sink.fail(error));
      return sink.handle;
    },
  };
}
