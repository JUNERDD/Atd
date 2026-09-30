import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { PermissionRequest } from '@ai/agent-contracts';
import type { McpServerConfig } from '@ai/agent-contracts';
import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { ServiceHandle } from '../dist/index.js';
import type { Logger } from '../dist/logging.js';
import { McpApprovalBroker } from '../dist/mcp/approval.js';
import { countCatalog } from '../dist/mcp/catalog.js';
import type { CountMemory } from '../dist/mcp/catalog-memory.js';
import { ConnectionManager } from '../dist/mcp/connect.js';
import { McpError, type OperationContext } from '../dist/mcp/errors.js';
import { McpFacade } from '../dist/mcp/facade.js';
import type { LaunchGate } from '../dist/mcp/launch-approvals.js';
import { McpConnectionStates } from '../dist/mcp/lifecycle.js';
import { CredentialTransactions } from '../dist/mcp/transactions.js';
import type { McpCredentialAuth, McpTransportFactory } from '../dist/mcp/types.js';
import { waitFor, type FakeMcpServer } from './mcp-fake-server.ts';

/**
 * What the MCP unit tests share: records to connect, a logger that keeps its lines, and a
 * `ConnectionManager` wired to an injected transport factory. The one place that builds the
 * manager, so a change of its dependencies is made here and nowhere else.
 */

/** The item at `index`, which the test knows is there. */
export function at<T>(items: readonly T[], index = 0): T {
  const item = items[index];
  assert.ok(item !== undefined, `expected an item at ${index} of ${items.length}`);
  return item;
}

/** A promise a test settles by hand, e.g. to hold a request open. */
export function deferred<T = void>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

export function memoryLog(): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const write = (message: string, fields?: Record<string, unknown>) =>
    void lines.push(JSON.stringify({ message, ...fields }));
  return { log: { debug: write, info: write, warn: write, error: write }, lines };
}

const defaults = {
  revision: 1,
  principal: '',
  isolateByTask: false,
  exposeResources: true,
  approveTools: false,
  includeTools: [],
  excludeTools: [],
  requestTimeoutMs: null,
  disabled: false,
};

/** A Streamable HTTP server with no auth; tools run without asking and resources are exposed. */
export function httpRecord(
  serverId: string,
  overrides: Partial<McpServerConfig> = {},
  http: Partial<NonNullable<McpServerConfig['http']>> = {},
): McpServerConfig {
  return {
    ...defaults,
    serverId,
    connectionId: `conn-${serverId}`,
    transport: 'streamable-http',
    stdio: null,
    http: {
      url: 'https://fake.example/mcp',
      transport: 'streamable-http',
      headers: {},
      auth: { type: 'none' },
      ...http,
    },
    ...overrides,
  };
}

export function stdioRecord(
  serverId: string,
  command: string,
  args: string[] = [],
  stdio: Partial<NonNullable<McpServerConfig['stdio']>> = {},
  overrides: Partial<McpServerConfig> = {},
): McpServerConfig {
  return {
    ...defaults,
    serverId,
    connectionId: `conn-${serverId}`,
    transport: 'stdio',
    stdio: { command, args, env: {}, cwd: null, ...stdio },
    http: null,
    ...overrides,
  };
}

/** The same server after an edit: a new revision, so another `reuseKey`. */
export const edited = (record: McpServerConfig): McpServerConfig => ({
  ...record,
  revision: record.revision + 1,
});

/** OAuth is not what these tests cover: no server they connect to signs in. */
const noOAuth: McpCredentialAuth = {
  authFor: () => {
    throw new Error('This test has no OAuth server.');
  },
  forget: () => undefined,
  settled: async () => undefined,
};

/** Remembers nothing: a server that is not connected reports zeros. */
const noMemory: CountMemory = {
  recall: () => undefined,
  remember: () => undefined,
  flush: async () => undefined,
};

export { waitFor };

/** Ends a call that a regression leaves pending, so the test fails instead of hanging. */
export const bounded = () => AbortSignal.timeout(3_000);

/** The state writes made from now on, as `<server> -> <state>`. */
export function watchStates(states: McpConnectionStates): string[] {
  const writes: string[] = [];
  const set = states.set.bind(states);
  states.set = (serverId, state, lastError) => {
    writes.push(`${serverId} -> ${state}`);
    set(serverId, state, lastError);
  };
  return writes;
}

/**
 * Holds the server's answer to `tools/list`, which counts the catalog while a connection opens:
 * `listing` waits until the server is asked, `proceed` lets the answer go.
 */
export function holdListing(fake: FakeMcpServer) {
  let listed = false;
  const proceed = deferred();
  const answer = fake.answer.bind(fake);
  fake.answer = async (session, request, signal) => {
    if (request.method === 'tools/list') {
      listed = true;
      await proceed.promise;
    }
    return answer(session, request, signal);
  };
  return { listing: () => waitFor(() => listed), proceed: () => proceed.resolve() };
}

export interface KitOptions {
  transports: McpTransportFactory;
  /** The launch gate; the default lets everything through (approvals: launch-approvals.test.ts). */
  launch?: LaunchGate;
  oauth?: McpCredentialAuth;
  bearerToken?: string | null;
  /** Keeps counts across disconnects and restarts; the default remembers nothing. */
  memory?: CountMemory;
  defaultCwd?: string;
  log?: Logger;
}

/** A `ConnectionManager` over `records` (edit the map to edit a server) with its states. */
export function createKit(records: McpServerConfig[], options: KitOptions) {
  const byId = new Map(records.map((record) => [record.serverId, record]));
  const log = options.log ?? memoryLog().log;
  const states = new McpConnectionStates(log);
  states.reset(records);
  const txns = new CredentialTransactions();
  const connections = new ConnectionManager({
    servers: {
      record: (serverId) => {
        const found = byId.get(serverId);
        if (!found)
          throw new McpError('not_found', serverId, `MCP server ${serverId} is not configured.`);
        return found;
      },
    },
    secrets: { bearerToken: async () => options.bearerToken ?? null },
    states,
    txns,
    launch: options.launch ?? { assertLaunch: async () => undefined },
    oauth: options.oauth ?? noOAuth,
    counter: countCatalog,
    transports: options.transports,
    memory: options.memory ?? noMemory,
    defaultCwd: options.defaultCwd ?? process.cwd(),
    log,
  });
  return { connections, states, txns, records: byId, log, dispose: () => connections.closeAll() };
}

/** `createKit` whose connections close when the test ends. */
export function kitFor(t: TestContext, records: McpServerConfig[], options: KitOptions) {
  const kit = createKit(records, options);
  t.after(() => kit.dispose());
  return kit;
}

export interface FacadeOptions extends KitOptions {
  /** The confirmations and artifacts of a running test service (service-harness.ts). */
  services: Pick<ServiceHandle, 'confirms' | 'resources'>;
}

/** A facade over the kit's connections, with the audit entries it wrote. */
export function facadeKit(t: TestContext, records: McpServerConfig[], options: FacadeOptions) {
  const kit = kitFor(t, records, options);
  const audit: Record<string, unknown>[] = [];
  const record = (entry: Record<string, unknown>) => void audit.push(entry);
  const { services } = options;
  const facade = new McpFacade({
    connections: kit.connections,
    states: kit.states,
    approvals: new McpApprovalBroker(services.confirms, record, kit.log),
    mapping: { resources: services.resources, log: kit.log },
    audit: record,
    log: kit.log,
  });
  return { ...kit, facade, audit };
}

export const operation = (overrides: Partial<OperationContext> = {}): OperationContext => ({
  operationId: 'op-1',
  taskId: 'task-1',
  runId: 'run-1',
  executionId: 'exec-1',
  ...overrides,
});

/**
 * A stand-in for a pi object (`ExtensionAPI`, `ExtensionContext`) whose many members the code under
 * test never touches: any member is a function that does nothing, so a test names the members it
 * cares about.
 */
export function piStandIn<T extends object>(members: Record<string, unknown> = {}): T {
  return new Proxy(Object.create(null), {
    get: (_target, key) => Reflect.get(members, key) ?? (() => undefined),
  });
}

/** A registered MCP proxy as the tests call it (tool-proxies.ts `mcpProxyTool`). */
export interface ProxyTool {
  name: string;
  description: string;
  parameters: unknown;
  annotations?: unknown;
  executionMode?: unknown;
  execute(
    id: string,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((update: { content: { text: string }[]; details: unknown }) => void) | undefined,
    ctx: unknown,
  ): Promise<{
    content: { type: 'text'; text: string }[];
    details: {
      server: string;
      tool: string;
      isError: boolean;
      attachments: { artifactId: string | null; kind: string; note: string }[];
      limitsNote: string;
    };
    structuredContent?: Record<string, unknown>;
    isError?: true;
  }>;
}

const isProxyTool = (value: unknown): value is ProxyTool =>
  typeof value === 'object' && value !== null && 'execute' in value && 'name' in value;

/** Runs an extension factory and returns the tools it registers. */
export async function registeredTools(factory: ExtensionFactory): Promise<ProxyTool[]> {
  const tools: ProxyTool[] = [];
  const registerTool = (tool: unknown) => {
    assert.ok(isProxyTool(tool), 'a proxy tool has a name and execute');
    tools.push(tool);
  };
  await factory(piStandIn<ExtensionAPI>({ registerTool }));
  return tools;
}

/** Answers the confirmation the next guarded call raises, and returns the request. */
export async function answerConfirm(
  confirms: FacadeOptions['services']['confirms'],
  decision: 'once' | 'session' | 'declined',
): Promise<PermissionRequest> {
  const deadline = Date.now() + 3000;
  while (confirms.pending().length === 0) {
    assert.ok(Date.now() < deadline, 'no confirmation was raised within 3 s');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const request = at(confirms.pending());
  await confirms.reply(request.id, request.revision, { decision });
  return request;
}
