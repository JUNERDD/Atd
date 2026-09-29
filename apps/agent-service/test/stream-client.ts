import { STREAM_AUTH_PROTOCOL_PREFIX, STREAM_PROTOCOL } from '@ai/agent-contracts';

export interface Frame {
  type: string;
  [key: string]: unknown;
}

function isFrame(value: unknown): value is Frame {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  );
}

/**
 * A stream connection that records every frame, so a test can await the next frame of a type
 * and inspect all frames received so far.
 */
export async function openStream(baseUrl: string, token: string) {
  const frames: Frame[] = [];
  let consumed = 0;
  let wake: (() => void) | null = null;
  const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/v1/stream`, [
    STREAM_PROTOCOL,
    `${STREAM_AUTH_PROTOCOL_PREFIX}${token}`,
  ]);
  socket.addEventListener('message', (event) => {
    const frame: unknown = JSON.parse(String(event.data));
    if (isFrame(frame)) frames.push(frame);
    wake?.();
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Stream did not open.')), {
      once: true,
    });
  });

  /** The next unconsumed frame of `type`, skipping (and consuming) frames of other types. */
  async function next(type: string, timeoutMs = 3000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (consumed < frames.length) {
        const frame = frames[consumed];
        consumed += 1;
        if (frame?.type === type) return frame;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`No ${type} frame within ${timeoutMs} ms.`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        wake = () => {
          clearTimeout(timer);
          wake = null;
          resolve();
        };
      });
    }
  }

  return {
    frames,
    next,
    send: (message: object) => socket.send(JSON.stringify(message)),
    /** Waits until every frame sent before this call has arrived (frames keep their order). */
    async drain(): Promise<void> {
      socket.send(JSON.stringify({ type: 'ping' }));
      await next('pong');
    },
    close: () => socket.close(),
  };
}
