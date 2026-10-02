import type { StreamTransportEvents, StreamTransportFactory } from '@atd/agent-client';
import type { NativeBridge } from '../native-bridge/client';

/**
 * Stream connections over the shell's virtual sockets. Each connection is one `socketId`; Swift
 * holds a real socket to the service for it, forwards frames unchanged, and never reconnects on its
 * own, so reconnect, backoff and resume stay in `AgentStreamClient`.
 */
export function nativeSocketTransport(bridge: NativeBridge): StreamTransportFactory {
  let next = 0;
  /** Connections the page has not closed; Swift sends nothing more for a closed id. */
  const sockets = new Map<string, StreamTransportEvents>();
  bridge.on('socket.frames', ({ frames }) => {
    for (const frame of frames) {
      const events = sockets.get(frame.socketId);
      if (!events) continue;
      if (frame.kind === 'open') events.onOpen();
      else if (frame.kind === 'message') events.onMessage(frame.data);
      else {
        sockets.delete(frame.socketId);
        events.onClose(frame.code, frame.reason);
      }
    }
  });
  return {
    open(url, events) {
      const path = new URL(url).pathname;
      if (path !== '/v1/stream') throw new Error(`The native shell relays no socket for ${path}.`);
      const socketId = `socket-${++next}`;
      sockets.set(socketId, events);
      bridge.post('socket.open', { socketId, path });
      return {
        send: (data) => {
          if (sockets.has(socketId)) bridge.post('socket.send', { socketId, data });
        },
        close: (code = 1000, reason = '') => {
          if (!sockets.delete(socketId)) return;
          bridge.post('socket.close', { socketId, code, reason });
          // A closed WebSocket still reports its close, later; the stream client expects one.
          queueMicrotask(() => events.onClose(code, reason));
        },
      };
    },
  };
}
