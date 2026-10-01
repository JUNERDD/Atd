import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import { echoServerResult, isRecord, parseRecord } from './mcp-http-kit.ts';

/**
 * A legacy HTTP+SSE MCP server (protocol 2024-11-05) for node:test: `GET /sse` opens the event
 * stream and announces the endpoint, requests are POSTed to that endpoint with 202 and answered on
 * the stream. Speaks initialize, ping and one `echo` tool. With a token, both the stream and the
 * POSTs answer 401 until the request carries `Authorization: Bearer <token>`.
 */

export interface SseServerOptions {
  /** The bearer token every request needs; none by default. */
  token?: string;
  /**
   * What the stream does: `ok` (announce the endpoint), `silent` (open the stream and never
   * announce), `error` (answer 500), `html` (answer 200 with a page, not an event stream).
   */
  mode?: 'ok' | 'silent' | 'error' | 'html';
  /** The `endpoint` event's data; a path on this server by default. */
  endpoint?: string;
}

export interface SseRequest {
  method: string;
  /** Path and query, as sent. */
  target: string;
  headers: IncomingHttpHeaders;
}

export interface SseServer {
  /** The event stream URL, `<base>/sse`. */
  url: string;
  base: string;
  requests: SseRequest[];
  /** The `method` of every JSON-RPC message POSTed with a live token. */
  received: string[];
  setToken(token: string | undefined): void;
  /** Ends every open event stream, like a dropped connection. */
  dropStreams(): void;
  close(): Promise<void>;
}

const send = (stream: ServerResponse, event: string, data: string) =>
  void stream.write(`event: ${event}\ndata: ${data}\n\n`);

export async function startSseServer(options: SseServerOptions = {}): Promise<SseServer> {
  let token = options.token;
  let base = '';
  const streams = new Map<string, ServerResponse>();
  const requests: SseRequest[] = [];
  const received: string[] = [];

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', base);
    const target = url.pathname + url.search;
    requests.push({ method: request.method ?? '', target, headers: request.headers });
    if (token !== undefined && request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { 'www-authenticate': 'Bearer realm="sse"' }).end();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/sse') {
      if (options.mode === 'error') return void response.writeHead(500).end();
      if (options.mode === 'html') {
        return void response.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
      }
      const id = randomUUID();
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      response.write(': the stream is open\n\n');
      streams.set(id, response);
      request.on('close', () => streams.delete(id));
      if (options.mode !== 'silent') {
        send(response, 'endpoint', options.endpoint ?? `/messages?sessionId=${id}`);
      }
      return;
    }
    if (request.method === 'POST' && url.pathname === '/messages') {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      request.on('end', () => {
        const { id, method, params } = parseRecord(body);
        response.writeHead(202).end();
        if (typeof method !== 'string') return;
        received.push(method);
        const stream = streams.get(url.searchParams.get('sessionId') ?? '');
        if (id === undefined || !stream) return;
        const result = echoServerResult(method, isRecord(params) ? params : {}, '2024-11-05');
        const reply =
          result === undefined
            ? { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
            : { jsonrpc: '2.0', id, result };
        send(stream, 'message', JSON.stringify(reply));
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('the SSE server did not bind to TCP');
  base = `http://127.0.0.1:${address.port}`;

  return {
    url: `${base}/sse`,
    base,
    requests,
    received,
    setToken: (next) => {
      token = next;
    },
    dropStreams: () => {
      for (const stream of streams.values()) stream.end();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
