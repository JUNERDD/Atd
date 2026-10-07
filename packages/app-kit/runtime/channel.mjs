// @ts-check
/**
 * A push-driven stream with a final result, shared by the browser SDK (`api.stream`) and the
 * backend runtime (`ctx.ai.stream`, `ctx.agent.run`). The producer starts at once and chunks
 * queue until the consumer iterates, so awaiting only `result` works too. Leaving a `for await`
 * loop early, or calling `cancel`, stops the producer through `onCancel`.
 */

/**
 * @template Chunk, Result
 * @typedef {AsyncIterable<Chunk> & { readonly result: Promise<Result>, cancel(): void }} StreamHandle
 */

/**
 * @template Chunk, Result
 * @typedef {object} StreamSink
 * @property {StreamHandle<Chunk, Result>} handle What the consumer gets.
 * @property {(chunk: Chunk) => void} push Queues a chunk (ignored once settled).
 * @property {(value: Result) => void} finish Ends the stream with its result.
 * @property {(error: unknown) => void} fail Ends the stream with an error.
 */

/**
 * @template Chunk, Result
 * @param {() => void} onCancel Called once when the consumer gives up before the stream ended.
 * @returns {StreamSink<Chunk, Result>}
 */
export function createStream(onCancel) {
  /** @type {Chunk[]} */
  const queue = [];
  /** @type {{ resolve: (r: IteratorResult<Chunk, undefined>) => void, reject: (e: unknown) => void }[]} */
  let waiters = [];
  let settled = false;
  /** @type {{ error: unknown } | null} */
  let failure = null;
  /** @type {(value: Result) => void} */
  let resolveResult = () => {};
  /** @type {(error: unknown) => void} */
  let rejectResult = () => {};
  /** @type {Promise<Result>} */
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // A consumer that only iterates never awaits `result`; keep its rejection from being unhandled.
  result.catch(() => {});

  const flush = () => {
    const pending = waiters;
    waiters = [];
    for (const waiter of pending) {
      if (failure) waiter.reject(failure.error);
      else waiter.resolve({ done: true, value: undefined });
    }
  };

  const cancel = () => {
    if (settled) return;
    settled = true;
    queue.length = 0;
    rejectResult(new Error('The stream was cancelled.'));
    flush();
    onCancel();
  };

  /** @type {StreamHandle<Chunk, Result>} */
  const handle = {
    result,
    cancel,
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queue.length > 0) {
            return Promise.resolve({ done: false, value: /** @type {Chunk} */ (queue.shift()) });
          }
          if (failure) return Promise.reject(failure.error);
          if (settled) return Promise.resolve({ done: true, value: undefined });
          return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
        },
        return() {
          cancel();
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };

  return {
    handle,
    push(chunk) {
      if (settled) return;
      const waiter = waiters.shift();
      if (waiter) waiter.resolve({ done: false, value: chunk });
      else queue.push(chunk);
    },
    finish(value) {
      if (settled) return;
      settled = true;
      resolveResult(value);
      flush();
    },
    fail(error) {
      if (settled) return;
      settled = true;
      failure = { error };
      rejectResult(error);
      flush();
    },
  };
}
