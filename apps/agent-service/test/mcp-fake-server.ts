import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  McpConnectionClosedError,
  McpError as RpcError,
  type CallToolResult,
  type ContentBlock,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ReadResourceResult,
  type Resource,
  type ResourceTemplate,
  type ServerCapabilities,
  type Tool,
} from '@earendil-works/pi-mcp';
import { InMemoryTransport } from '@earendil-works/pi-mcp/testing';
import type {
  McpTransportFactory,
  OAuthConnectionAuth,
  ResolvedLaunch,
} from '../dist/mcp/types.js';

/**
 * An in-memory MCP server for tests. pi-mcp's testing entry only offers the transport pair, so this
 * adds the server: a JSON-RPC responder over a catalog the test edits (`new FakeMcpServer({ tools })`
 * or assign the fields), with scripted tool results, progress, cancellation observation,
 * list_changed, requests to the client, injected transport failures and dropped connections.
 * `client.connect(fake.connect())` serves one McpClient; `fake.factory` serves one session per dial.
 */

/** What a tool handler gets; `progress` sends notifications only when the client asked for them. */
export interface FakeCallContext {
  session: FakeSession;
  /** Aborts when the client cancels the request or the connection closes. */
  signal: AbortSignal;
  progress(progress: number, total?: number, message?: string): Promise<void>;
}

export type FakeToolHandler = (
  args: Record<string, unknown>,
  ctx: FakeCallContext,
) => CallToolResult | Promise<CallToolResult>;

/** A tool without a handler answers with its own name as text. */
export interface FakeTool {
  definition: Tool;
  handler?: FakeToolHandler;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const compact = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
const notFound = (method: string) => new RpcError(-32601, `Method not found: ${method}`);
export const say = (text: string): ContentBlock => ({ type: 'text', text });
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `condition` every 10 ms until it holds; throws after `timeoutMs`. */
export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs} ms`);
    await sleep(10);
  }
}

/** One client connection to a `FakeMcpServer`, and everything its client sent. */
export class FakeSession {
  readonly transport: InMemoryTransport;
  /** The client's initialize params (`protocolVersion`, `capabilities`, `clientInfo`). */
  initialize: Record<string, unknown> | undefined;
  readonly requests: JsonRpcRequest[] = [];
  readonly cancelled: { requestId: JsonRpcId; reason: string | undefined }[] = [];
  closed = false;
  private readonly server: FakeMcpServer;
  private readonly inflight = new Map<JsonRpcId, AbortController>();
  private readonly waiting = new Map<JsonRpcId, (response: JsonRpcResponse) => void>();
  private nextId = 1;

  constructor(server: FakeMcpServer, transport: InMemoryTransport) {
    this.server = server;
    this.transport = transport;
    transport.onMessage((message) => this.receive(message));
    transport.onClose(() => this.onClosed());
    void transport.start();
  }

  notify(method: string, params?: Record<string, unknown>): Promise<void> {
    return this.transport.send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
  }

  /** Sends a request to the client (sampling, roots, ping); its response, or never if the connection drops. */
  async request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = `srv-${this.nextId++}`;
    const answer = new Promise<JsonRpcResponse>((resolve) => this.waiting.set(id, resolve));
    await this.transport.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    return answer;
  }

  /** Closes the connection from the server side, like a crashed server or a dropped socket. */
  readonly drop = (): Promise<void> => this.transport.close();

  context(request: JsonRpcRequest, signal: AbortSignal): FakeCallContext {
    const params = isRecord(request.params) ? request.params : {};
    const token = isRecord(params._meta) ? params._meta.progressToken : undefined;
    return {
      session: this,
      signal,
      progress: async (progress, total, message) => {
        if (typeof token !== 'string' && typeof token !== 'number') return;
        const update = compact({ progressToken: token, progress, total, message });
        await this.notify('notifications/progress', update);
      },
    };
  }

  private receive(message: JsonRpcMessage): void {
    if (isJsonRpcResponse(message)) {
      this.waiting.get(message.id)?.(message);
      this.waiting.delete(message.id);
    } else if (isJsonRpcRequest(message)) {
      this.requests.push(message);
      void this.serve(message);
    } else if (isJsonRpcNotification(message) && message.method === 'notifications/cancelled') {
      const body = isRecord(message.params) ? message.params : {};
      const id = body.requestId;
      if (typeof id !== 'string' && typeof id !== 'number') return;
      const reason = typeof body.reason === 'string' ? body.reason : undefined;
      this.cancelled.push({ requestId: id, reason });
      this.inflight.get(id)?.abort(new Error(reason ?? 'cancelled'));
    }
  }

  private async serve(request: JsonRpcRequest): Promise<void> {
    const controller = new AbortController();
    this.inflight.set(request.id, controller);
    let reply: JsonRpcResponse;
    try {
      const result = await this.server.answer(this, request, controller.signal);
      reply = { jsonrpc: '2.0', id: request.id, result };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const { code, message, data } =
        error instanceof RpcError ? error : new RpcError(-32603, text);
      reply = { jsonrpc: '2.0', id: request.id, error: { code, message, data } };
    }
    this.inflight.delete(request.id);
    // A cancelled request gets no answer, and a dropped connection cannot carry one.
    if (!controller.signal.aborted) await this.transport.send(reply).catch(() => undefined);
  }

  private onClosed(): void {
    this.closed = true;
    const closed = new McpConnectionClosedError();
    for (const controller of this.inflight.values()) controller.abort(closed);
  }
}

export class FakeMcpServer {
  /** A family left out answers -32601 to its methods. */
  capabilities: ServerCapabilities = {
    tools: { listChanged: true },
    resources: { listChanged: true },
    prompts: { listChanged: true },
  };
  tools: FakeTool[] = [];
  resources: Resource[] = [];
  /** null: resources/templates/list answers -32601, as servers without templates do. */
  templates: ResourceTemplate[] | null = [];
  prompts: { name: string; [field: string]: unknown }[] = [];
  /** Prompts per prompts/list page (cursors are `page-<n>`); 0 lists all at once. */
  promptPageSize = 0;
  /** The last page repeats the cursor that led to it, which clients must refuse. */
  repeatPromptCursor = false;
  /** What resources/read answers by exact URI; other URIs answer -32002. */
  contents = new Map<string, ReadResourceResult['contents'][number]>();
  /** Every connection ever made, including attempts that failed before initialize. */
  readonly sessions: FakeSession[] = [];
  /** What each dial through `factory` asked for. */
  readonly launches: { launch: ResolvedLaunch; auth: OAuthConnectionAuth | undefined }[] = [];
  /** For `ConnectionManager` and the pool: records the launch, then dials this server. */
  readonly factory: McpTransportFactory = (launch, auth) => {
    this.launches.push({ launch, auth });
    return this.connect();
  };
  private readonly faults: { method: string; remaining: number; error: () => Error }[] = [];

  constructor(init: Partial<FakeMcpServer> = {}) {
    Object.assign(this, init);
  }

  /** A new connection: the client end of a fresh in-memory pair, for `McpClient.connect`. */
  connect(): InMemoryTransport {
    const client = new InMemoryTransport();
    const server = new InMemoryTransport();
    client.connectPeer(server);
    server.connectPeer(client);
    // Injected failures happen in `send`, before anything reaches the server, like an HTTP error.
    const send = client.send.bind(client);
    client.send = async (message) => {
      const fail = isJsonRpcRequest(message) ? this.takeFault(message.method) : undefined;
      if (fail) throw fail();
      await send(message);
    };
    this.sessions.push(new FakeSession(this, server));
    return client;
  }

  /** Sessions whose client initialized and that are still connected. */
  open(): FakeSession[] {
    return this.sessions.filter((session) => session.initialize && !session.closed);
  }

  /** Every request the clients sent, optionally of one method. */
  requests(method?: string): JsonRpcRequest[] {
    const all = this.sessions.flatMap((session) => session.requests);
    return method === undefined ? all : all.filter((request) => request.method === method);
  }

  /** Sends `notifications/<kind>/list_changed` on every open connection. */
  async notifyListChanged(kind: 'tools' | 'resources' | 'prompts'): Promise<void> {
    const method = `notifications/${kind}/list_changed`;
    await Promise.all(this.open().map((session) => session.notify(method)));
  }

  /**
   * Fails the next `times` client requests of `method` inside the transport, before they are sent:
   * `new McpHttpError(503, …)` on initialize is a transient HTTP failure, `new McpSessionExpiredError()`
   * on tools/call a session the server forgot.
   */
  failNext(method: string, times: number, error: () => Error): void {
    this.faults.push({ method, remaining: times, error });
  }

  private takeFault(method: string): (() => Error) | undefined {
    const fault = this.faults.find((item) => item.method === method && item.remaining > 0);
    if (fault) fault.remaining -= 1;
    return fault?.error;
  }

  /** Answers one client request; a thrown error becomes the JSON-RPC error response. */
  async answer(session: FakeSession, request: JsonRpcRequest, signal: AbortSignal) {
    const { method } = request;
    const params = isRecord(request.params) ? request.params : {};
    const family = method.split('/')[0];
    const gated = family === 'tools' || family === 'resources' || family === 'prompts';
    if (gated && this.capabilities[family] === undefined) throw notFound(method);
    switch (method) {
      case 'initialize':
        session.initialize = params;
        return {
          protocolVersion: params.protocolVersion,
          capabilities: this.capabilities,
          serverInfo: { name: 'fake', version: '1.0.0' },
        };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: this.tools.map((entry) => entry.definition) };
      case 'tools/call': {
        const name = String(params.name);
        const entry = this.tools.find((candidate) => candidate.definition.name === name);
        if (!entry) throw new RpcError(-32602, `Unknown tool: ${name}`);
        const args = isRecord(params.arguments) ? params.arguments : {};
        const result = await entry.handler?.(args, session.context(request, signal));
        return result ?? { content: [say(name)] };
      }
      case 'resources/list':
        return { resources: this.resources };
      case 'resources/templates/list':
        if (this.templates === null) throw notFound(method);
        return { resourceTemplates: this.templates };
      case 'resources/read': {
        const uri = String(params.uri);
        const found = this.contents.get(uri);
        if (!found) throw new RpcError(-32002, `Resource not found: ${uri}`);
        return { contents: [found] };
      }
      case 'prompts/list':
        return this.promptsPage(params.cursor);
      case 'prompts/get': {
        const text = `${String(params.name)} ${JSON.stringify(params.arguments ?? {})}`;
        return { messages: [{ role: 'user', content: say(text) }] };
      }
      default:
        throw notFound(method);
    }
  }

  private promptsPage(cursor: unknown) {
    const size = this.promptPageSize;
    if (size === 0) return { prompts: this.prompts };
    const page = typeof cursor === 'string' ? Number(cursor.replace(/^page-/, '')) : 0;
    const more = (page + 1) * size < this.prompts.length;
    const repeated = this.repeatPromptCursor && typeof cursor === 'string' ? cursor : undefined;
    const nextCursor = more ? `page-${page + 1}` : repeated;
    const prompts = this.prompts.slice(page * size, (page + 1) * size);
    return { prompts, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }
}
