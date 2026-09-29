/**
 * Callbacks a transport reports into. The stream client passes them to `open`; a transport must
 * not call them synchronously from `open`, and reports at most one `onClose` per connection.
 */
export interface StreamTransportEvents {
  onOpen: () => void;
  onMessage: (text: string) => void;
  /**
   * The connection ended, whether it opened or not. `code` and `reason` are the peer's or the
   * relay's close frame unchanged (for example 1008 policy violation or 1012 service restart);
   * every close drives the client's reconnect path.
   */
  onClose: (code: number, reason: string) => void;
  /** Informational only; the transport must still report `onClose`, which drives reconnect. */
  onError: () => void;
}

/** One stream connection. `send` after the connection ended must be ignored, not throw. */
export interface StreamTransport {
  send: (text: string) => void;
  close: (code?: number, reason?: string) => void;
}

/**
 * Opens stream connections for `AgentStreamClient`. The client owns reconnect, backoff, epoch/seq
 * resume and subscribe; a transport only carries text frames and close codes for one connection.
 */
export interface StreamTransportFactory {
  open: (url: string, events: StreamTransportEvents) => StreamTransport;
}

/**
 * Default transport over the standard `WebSocket` global (Node 22+, Electron, browsers), offering
 * the given subprotocols.
 */
export function webSocketTransport(protocols: string[]): StreamTransportFactory {
  return {
    open(url, events) {
      const socket = new WebSocket(url, protocols);
      socket.addEventListener('open', () => events.onOpen());
      socket.addEventListener('message', (event) => events.onMessage(String(event.data)));
      socket.addEventListener('close', (event) => events.onClose(event.code, event.reason));
      socket.addEventListener('error', () => events.onError());
      return {
        send: (text) => socket.send(text),
        close: (code, reason) => socket.close(code, reason),
      };
    },
  };
}
