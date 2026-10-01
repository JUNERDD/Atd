import {
  McpAuthRequiredError,
  McpConnectionClosedError,
  McpHttpError,
  parseJsonRpcMessage,
  type AuthProvider,
  type JsonRpcMessage,
  type McpFetch,
  type McpTransport,
  type McpTransportCloseListener,
  type McpTransportErrorListener,
  type McpTransportMessageListener,
} from '@earendil-works/pi-mcp';
import { createParser, type EventSourceMessage } from 'eventsource-parser';

/**
 * The legacy HTTP+SSE transport (MCP 2024-11-05), which pi-mcp does not ship: the client opens a
 * GET event stream, the server's first event names the endpoint to POST requests to, and every
 * answer and notification comes back as a `message` event on that stream. Servers configured with
 * `transport: 'sse'` keep working through it. It does not reconnect: a dropped stream closes the
 * transport, and the pool opens a new connection on the next use.
 */

export interface LegacySseOptions {
  url: string;
  headers: Record<string, string>;
  authProvider?: AuthProvider;
  fetch?: McpFetch;
  /** How long `start` waits for the `endpoint` event. Default: 30 s. */
  endpointTimeoutMs?: number;
}

const ENDPOINT_TIMEOUT_MS = 30_000;
/** One event's data may not exceed this; the same 16 MiB pi-mcp allows a message. */
const MAX_EVENT_CHARS = 16 * 1024 * 1024;
const MAX_ERROR_BODY_CHARS = 8 * 1024;
const ERROR_MESSAGE_BODY_CHARS = 500;

interface Announce {
  resolve(endpoint: URL): void;
  reject(error: Error): void;
}

export class LegacySseTransport implements McpTransport {
  private readonly url: URL;
  private readonly fetch: McpFetch;
  private readonly controller = new AbortController();
  private readonly messageListeners = new Set<McpTransportMessageListener>();
  private readonly errorListeners = new Set<McpTransportErrorListener>();
  private readonly closeListeners = new Set<McpTransportCloseListener>();
  private endpoint: URL | undefined;
  private protocolVersion: string | undefined;
  private started = false;
  private closed = false;

  constructor(private readonly options: LegacySseOptions) {
    this.url = new URL(options.url);
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  onMessage(listener: McpTransportMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: McpTransportErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: McpTransportCloseListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  /**
   * Opens the event stream and resolves once the server has named its endpoint. A server that
   * never answers, or never names one, would hold the connect forever, so the whole wait is
   * bounded.
   */
  async start(): Promise<void> {
    if (this.started) throw new Error('MCP legacy SSE transport already started');
    if (this.closed) throw new McpConnectionClosedError();
    this.started = true;
    const timeoutMs = this.options.endpointTimeoutMs ?? ENDPOINT_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`MCP SSE server did not announce its endpoint within ${timeoutMs} ms`));
      }, timeoutMs);
    });
    try {
      this.endpoint = await Promise.race([this.openStream(), deadline]);
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async send(message: JsonRpcMessage): Promise<void> {
    const endpoint = this.endpoint;
    if (!this.started || this.closed || !endpoint) throw new McpConnectionClosedError();
    const response = await this.authorizedFetch(
      endpoint,
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify(message),
    );
    await this.checkResponse(response);
    // The answer arrives on the event stream; a 2xx body is only an acknowledgement.
    await discard(response);
  }

  async close(): Promise<void> {
    this.finish();
  }

  /** Opens the GET stream, and resolves with the endpoint the first `endpoint` event names. */
  private async openStream(): Promise<URL> {
    const response = await this.authorizedFetch(this.url, 'GET', { accept: 'text/event-stream' });
    await this.checkResponse(response);
    const type = contentType(response);
    const { body } = response;
    if (type !== 'text/event-stream' || !body) {
      await discard(response);
      throw new McpHttpError(
        response.status,
        `Unsupported MCP SSE response content type: ${type ?? 'missing'}`,
      );
    }
    return new Promise<URL>((resolve, reject) => {
      void this.read(body, { resolve, reject });
    });
  }

  private async read(body: ReadableStream<Uint8Array>, announce: Announce): Promise<void> {
    const parser = createParser({
      maxBufferSize: MAX_EVENT_CHARS,
      onEvent: (event) => this.dispatch(event, announce),
      onError: (error) => {
        // Unknown fields and bad `retry` values are ignored, as the SSE format says; an event that
        // never ends would grow without bound, so that one ends the stream.
        if (error.type !== 'max-buffer-size-exceeded') return;
        this.emitError(new Error(`MCP SSE event exceeds ${MAX_EVENT_CHARS} characters`));
        this.finish();
      },
    });
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      if (!this.closed) {
        // Before the endpoint event this fails the start with the real cause.
        announce.reject(asError(error));
        this.emitError(error);
      }
    } finally {
      reader.releaseLock();
      announce.reject(
        this.closed
          ? new McpConnectionClosedError()
          : new Error('MCP SSE stream ended before the endpoint event'),
      );
      this.finish();
    }
  }

  private dispatch(event: EventSourceMessage, announce: Announce): void {
    if (event.event === 'endpoint') {
      try {
        const endpoint = new URL(event.data.trim(), this.url);
        if (endpoint.origin !== this.url.origin) {
          throw new Error('MCP SSE endpoint is on another origin than the server');
        }
        announce.resolve(endpoint);
      } catch (error) {
        announce.reject(asError(error));
      }
      return;
    }
    // A stream event without a type is a message; other types are not JSON-RPC.
    if ((event.event !== undefined && event.event !== 'message') || !event.data.trim()) return;
    try {
      const message = parseJsonRpcMessage(JSON.parse(event.data));
      for (const listener of this.messageListeners) listener(message);
    } catch (error) {
      this.emitError(error);
    }
  }

  /**
   * Fetch with auth headers. A 401 (or a 403 asking for more scope) is handed to the auth provider
   * once, and the request is retried with whatever credentials it left behind.
   */
  private async authorizedFetch(
    target: URL,
    method: 'GET' | 'POST',
    extra: Record<string, string>,
    body?: string,
  ): Promise<Response> {
    const onUnauthorized = this.options.authProvider?.onUnauthorized?.bind(
      this.options.authProvider,
    );
    for (let attempt = 0; ; attempt++) {
      const { headers, token } = await this.headers(extra);
      const response = await this.fetch(target, {
        method,
        headers,
        body,
        signal: this.controller.signal,
      });
      if (attempt > 0 || !onUnauthorized || !needsAuthorization(response)) return response;
      try {
        await onUnauthorized({ response, serverUrl: this.url, fetch: this.fetch, token });
      } finally {
        await discard(response);
      }
    }
  }

  /** The configured headers, the request's own, then the token, which wins over `Authorization`. */
  private async headers(
    extra: Record<string, string>,
  ): Promise<{ headers: Headers; token?: string }> {
    const headers = new Headers(this.options.headers);
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);
    if (this.protocolVersion) headers.set('MCP-Protocol-Version', this.protocolVersion);
    const token = await this.options.authProvider?.token();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return { headers, ...(token ? { token } : {}) };
  }

  private async checkResponse(response: Response): Promise<void> {
    if (response.ok) return;
    const body = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY_CHARS);
    if (response.status === 401) throw new McpAuthRequiredError(response, body);
    const text = body.trim();
    const snippet =
      text.length > ERROR_MESSAGE_BODY_CHARS
        ? `${text.slice(0, ERROR_MESSAGE_BODY_CHARS - 3)}...`
        : text;
    throw new McpHttpError(
      response.status,
      `MCP HTTP request failed with status ${response.status}${snippet ? `: ${snippet}` : ''}`,
      body,
    );
  }

  private emitError(error: unknown): void {
    const normalized = asError(error);
    for (const listener of this.errorListeners) listener(normalized);
  }

  /** Closes for good: aborts the stream and tells the listeners, once. */
  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    for (const listener of this.closeListeners) listener();
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** 401, or 403 with an `insufficient_scope` bearer challenge (step-up authorization). */
function needsAuthorization(response: Response): boolean {
  if (response.status === 401) return true;
  if (response.status !== 403) return false;
  return /(?:^|[\s,])error="?insufficient_scope"?/i.test(
    response.headers.get('www-authenticate') ?? '',
  );
}

function contentType(response: Response): string | undefined {
  return response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
}

function discard(response: Response): Promise<void> {
  return response.body?.cancel().catch(() => undefined) ?? Promise.resolve();
}
