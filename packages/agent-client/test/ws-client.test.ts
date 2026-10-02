import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import {
  AgentStreamClient,
  type StreamHandlers,
  type StreamTransportEvents,
  type StreamTransportFactory,
} from '@atd/agent-client';
import { STREAM_AUTH_PROTOCOL_PREFIX, STREAM_PROTOCOL } from '@atd/agent-contracts';

interface FakeConnection {
  url: string;
  events: StreamTransportEvents;
  sent: unknown[];
  closes: { code: number | undefined; reason: string | undefined }[];
}

/** Records every connection the client opens so a test can drive it like a relay would. */
function fakeTransport() {
  const connections: FakeConnection[] = [];
  const factory: StreamTransportFactory = {
    open(url, events) {
      const connection: FakeConnection = { url, events, sent: [], closes: [] };
      connections.push(connection);
      return {
        send: (text) => connection.sent.push(JSON.parse(text)),
        close: (code, reason) => connection.closes.push({ code, reason }),
      };
    },
  };
  return { factory, connections };
}

function recordingHandlers() {
  const disconnects: string[] = [];
  const handlers: StreamHandlers = {
    onSnapshot: () => undefined,
    onSummaries: () => undefined,
    onEvent: () => undefined,
    onDisconnect: (reason) => disconnects.push(reason),
  };
  return { handlers, disconnects };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

test('resumes the stream position through the injected transport after a relay restart close', () => {
  const { factory, connections } = fakeTransport();
  const { handlers, disconnects } = recordingHandlers();
  const client = new AgentStreamClient(
    { baseUrl: 'http://127.0.0.1:4000', token: 'unused', transport: factory },
    handlers,
    ['task-1'],
  );

  client.connect();
  assert.equal(connections[0]?.url, 'ws://127.0.0.1:4000/v1/stream');
  connections[0]?.events.onOpen();
  assert.deepEqual(connections[0]?.sent, [
    { type: 'subscribe', epoch: 0, seq: 0, taskIds: ['task-1'] },
  ]);
  connections[0]?.events.onMessage(
    JSON.stringify({ type: 'summaries', epoch: 3, seq: 41, tasks: [] }),
  );

  connections[0]?.events.onClose(1012, 'service restart');
  assert.deepEqual(disconnects, ['Stream closed (1012 service restart).']);
  mock.timers.tick(249);
  assert.equal(connections.length, 1);
  mock.timers.tick(1);
  assert.equal(connections.length, 2);

  connections[1]?.events.onOpen();
  assert.deepEqual(connections[1]?.sent, [
    { type: 'subscribe', epoch: 3, seq: 41, taskIds: ['task-1'] },
  ]);
  client.close();
});

test('treats a policy close before open as a drop and backs off exponentially', () => {
  const { factory, connections } = fakeTransport();
  const { handlers, disconnects } = recordingHandlers();
  const client = new AgentStreamClient(
    { baseUrl: 'https://svc.test', token: 'unused', transport: factory },
    handlers,
  );

  client.connect();
  assert.equal(connections[0]?.url, 'wss://svc.test/v1/stream');
  connections[0]?.events.onClose(1008, 'frame not allowed');
  mock.timers.tick(250);
  connections[1]?.events.onClose(1008, '');
  mock.timers.tick(499);
  assert.equal(connections.length, 2);
  mock.timers.tick(1);
  assert.equal(connections.length, 3);
  assert.deepEqual(disconnects, [
    'Stream closed (1008 frame not allowed).',
    'Stream closed (1008).',
  ]);
  client.close();
});

test('close() closes the transport and ignores its late close', () => {
  const { factory, connections } = fakeTransport();
  const { handlers, disconnects } = recordingHandlers();
  const client = new AgentStreamClient(
    { baseUrl: 'http://127.0.0.1:4000', token: 'unused', transport: factory },
    handlers,
  );

  client.connect();
  connections[0]?.events.onOpen();
  client.close();
  assert.deepEqual(connections[0]?.closes, [{ code: undefined, reason: undefined }]);
  connections[0]?.events.onClose(1005, '');
  mock.timers.tick(5000);
  assert.equal(connections.length, 1);
  assert.deepEqual(disconnects, []);
});

test('a superseded connection neither reports its close nor schedules a reconnect', () => {
  const { factory, connections } = fakeTransport();
  const { handlers, disconnects } = recordingHandlers();
  const client = new AgentStreamClient(
    { baseUrl: 'http://127.0.0.1:4000', token: 'unused', transport: factory },
    handlers,
  );

  // close() + connect(): the first transport's close arrives after the second connection opened.
  client.connect();
  connections[0]?.events.onOpen();
  client.close();
  client.connect();
  connections[1]?.events.onOpen();
  connections[0]?.events.onClose(1006, 'late');
  // A second connect() without close() supersedes the current connection the same way.
  client.connect();
  assert.deepEqual(connections[1]?.closes, [{ code: undefined, reason: undefined }]);
  connections[1]?.events.onOpen();
  connections[1]?.events.onMessage(JSON.stringify({ type: 'resumed', seq: 9 }));
  connections[1]?.events.onClose(1006, 'late');
  mock.timers.tick(5000);

  assert.equal(connections.length, 3);
  assert.deepEqual(disconnects, []);
  assert.equal(client.seq, 0);
  // Only the current connection subscribed after its own open.
  assert.deepEqual(connections[1]?.sent, [{ type: 'subscribe', epoch: 0, seq: 0 }]);
  assert.deepEqual(connections[2]?.sent, []);

  // The current connection still drives reconnect.
  connections[2]?.events.onClose(1012, '');
  assert.deepEqual(disconnects, ['Stream closed (1012).']);
  mock.timers.tick(250);
  assert.equal(connections.length, 4);
  client.close();
});

test('connect() during a pending reconnect replaces it instead of opening twice', () => {
  const { factory, connections } = fakeTransport();
  const { handlers } = recordingHandlers();
  const client = new AgentStreamClient(
    { baseUrl: 'http://127.0.0.1:4000', token: 'unused', transport: factory },
    handlers,
  );

  client.connect();
  connections[0]?.events.onClose(1006, '');
  client.connect();
  mock.timers.tick(5000);
  assert.equal(connections.length, 2);
  client.close();
});

test('answers capability requests over the open transport', async () => {
  const { factory, connections } = fakeTransport();
  const { handlers } = recordingHandlers();
  const client = new AgentStreamClient(
    { baseUrl: 'http://127.0.0.1:4000', token: 'unused', transport: factory },
    handlers,
    [],
    [
      {
        capability: 'clipboard.read',
        handle: async (request) => ({
          requestId: request.id,
          revision: request.revision,
          ok: true,
          value: 'copied',
        }),
      },
    ],
  );

  client.connect();
  connections[0]?.events.onOpen();
  connections[0]?.events.onMessage(
    JSON.stringify({
      type: 'capability.request',
      request: {
        id: 'req-1',
        revision: 2,
        capability: 'clipboard.read',
        input: null,
        taskId: 'task-1',
        runId: 'run-1',
        executionId: 'exec-1',
        operationId: 'op-1',
        expiresAt: '2026-09-29T00:00:00.000Z',
        createdAt: '2026-09-29T00:00:00.000Z',
      },
    }),
  );
  await flush();
  assert.deepEqual(connections[0]?.sent, [
    { type: 'subscribe', epoch: 0, seq: 0 },
    { type: 'capability.register', capabilities: ['clipboard.read'] },
    {
      type: 'capability.result',
      result: { requestId: 'req-1', revision: 2, ok: true, value: 'copied' },
    },
  ]);
  client.close();
});

test('defaults to the WebSocket global with the auth subprotocol and forwards close codes', () => {
  const sockets: FakeWebSocket[] = [];
  class FakeWebSocket extends EventTarget {
    readonly sent: string[] = [];
    readonly url: string;
    readonly protocols: string[];
    constructor(url: string, protocols: string[]) {
      super();
      this.url = url;
      this.protocols = protocols;
      sockets.push(this);
    }
    send(text: string) {
      this.sent.push(text);
    }
    close() {}
  }
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  try {
    const { handlers, disconnects } = recordingHandlers();
    const client = new AgentStreamClient(
      { baseUrl: 'http://127.0.0.1:4000', token: 'secret' },
      handlers,
    );
    client.connect();
    const socket = sockets[0];
    assert.equal(socket?.url, 'ws://127.0.0.1:4000/v1/stream');
    assert.deepEqual(socket?.protocols, [STREAM_PROTOCOL, `${STREAM_AUTH_PROTOCOL_PREFIX}secret`]);
    socket?.dispatchEvent(new Event('open'));
    assert.equal(socket?.sent.length, 1);
    socket?.dispatchEvent(Object.assign(new Event('close'), { code: 1012, reason: 'restart' }));
    assert.deepEqual(disconnects, ['Stream closed (1012 restart).']);
    client.close();
  } finally {
    globalThis.WebSocket = original;
  }
});
