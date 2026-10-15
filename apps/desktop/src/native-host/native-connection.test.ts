import type { StreamTransportEvents, StreamTransportFactory } from '@atd/agent-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativeConnection } from './native-connection';

function harness() {
  const sockets: StreamTransportEvents[] = [];
  const transport: StreamTransportFactory = {
    open(_url, events) {
      sockets.push(events);
      return { send: () => undefined, close: () => undefined };
    },
  };
  const connection = new NativeConnection({
    baseUrl: 'ai-app://renderer',
    relay: true,
    transport,
  });
  connection.connect();
  const current = () => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error('The connection did not open a stream.');
    return socket;
  };
  return { connection, current };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('leaves startup on failure and recovers when the service becomes available', async () => {
  const { connection, current } = harness();
  const changed = vi.fn();
  connection.onStatus(changed);
  expect(connection.status().state).toBe('connecting');
  current().onClose(1013, 'The agent service is starting.');
  expect(connection.status().state).toBe('connecting');
  vi.advanceTimersByTime(250);
  current().onClose(1011, 'The agent service is not available.');
  expect(connection.status().state).toBe('disconnected');
  expect(connection.unavailable()).toContain('The agent service is not available.');
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'disconnected' }));

  vi.advanceTimersByTime(500);
  current().onOpen();
  current().onMessage(JSON.stringify({ type: 'summaries', epoch: 1, seq: 0, tasks: [] }));
  await Promise.resolve();
  expect(connection.status().state).toBe('connected');
  expect(connection.unavailable()).toBe('');
  current().onClose(1012, 'The agent service restarted.');
  expect(connection.status().state).toBe('reconnecting');
});

it.each([1006, 1008, 1011])('reports an initial close with code %i as disconnected', (code) => {
  const { connection, current } = harness();
  current().onClose(code, 'Synthetic failure');
  expect(connection.status().state).toBe('disconnected');
  expect(connection.unavailable()).toContain('Synthetic failure');
});
