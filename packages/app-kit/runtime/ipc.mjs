// @ts-check
/**
 * The backend child's half of the service IPC protocol (`@atd/agent-contracts` `apps-ipc.ts`):
 * sending with the size limit, and the capability requests the child makes. Calls the parent
 * makes are served by `bootstrap.mjs`.
 */
import { createStream } from './channel.mjs';
import { fromWire, toWire } from './wire.mjs';

/** @typedef {import('../src/contracts.ts').AppChildMessage} ChildMessage */
/** @typedef {import('../src/contracts.ts').AppParentMessage} ParentMessage */
/** @typedef {import('../src/contracts.ts').AppCapRequest} CapRequest */
/** @typedef {import('../src/contracts.ts').AppError} AppError */

/**
 * `MAX_IPC_MESSAGE_BYTES` of the contract. The runtime cannot import the contracts package: the
 * sandbox lets the child read only its version, this runtime and its data directory.
 */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/** An error with the `{code, message}` the protocol carries. */
export class WireFailure extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Sends one message; throws `payload_too_large` instead of sending an oversized one.
 * @param {ChildMessage} message
 */
export function send(message) {
  if (!process.send) throw new Error('The backend runtime needs an IPC channel to the service.');
  if (Buffer.byteLength(JSON.stringify(message)) > MAX_MESSAGE_BYTES) {
    throw new WireFailure('payload_too_large', 'The message exceeds the 4 MiB IPC limit.');
  }
  process.send(message);
}

/**
 * The `{code, message}` of anything thrown.
 * @param {unknown} error
 * @param {string} fallbackCode
 * @returns {AppError}
 */
export function toWireError(error, fallbackCode) {
  const code = error instanceof WireFailure ? error.code : fallbackCode;
  const message = error instanceof Error ? error.message : String(error);
  return { code, message: message.slice(0, 4000) };
}

/**
 * @typedef {object} PendingCap
 * @property {(data: unknown) => void} chunk
 * @property {(value: unknown) => void} resolve
 * @property {(error: unknown) => void} reject
 */

/** @type {Map<string, PendingCap>} */
const pending = new Map();
let nextCapId = 0;

/**
 * Posts a capability request and registers its reply handlers.
 * @param {CapRequest['cap']} cap
 * @param {string} op
 * @param {unknown} input
 * @param {PendingCap} handlers
 */
function request(cap, op, input, handlers) {
  nextCapId += 1;
  const id = `c${nextCapId}`;
  pending.set(id, handlers);
  try {
    // The parent validates `{cap, op, input}` against the operation's schema.
    send(/** @type {CapRequest} */ ({ t: 'cap', id, cap, op, input: toWire(input) }));
  } catch (error) {
    pending.delete(id);
    handlers.reject(error);
  }
  return id;
}

/**
 * A capability operation that answers once. The parent validates the reply against the
 * operation's output schema, so the caller states the type it gets.
 * @template T
 * @param {CapRequest['cap']} cap
 * @param {string} op
 * @param {unknown} input
 * @returns {Promise<T>}
 */
export function capCall(cap, op, input) {
  return new Promise((resolve, reject) => {
    request(cap, op, input, {
      chunk: () => {},
      resolve: (value) => resolve(/** @type {T} */ (value)),
      reject,
    });
  });
}

/**
 * A streaming capability operation; leaving the stream early sends `cancel` to the parent.
 * @template Chunk, Result
 * @param {CapRequest['cap']} cap
 * @param {string} op
 * @param {unknown} input
 * @returns {import('./channel.mjs').StreamHandle<Chunk, Result>}
 */
export function capStream(cap, op, input) {
  /** @type {string | null} */
  let id = null;
  /** @type {import('./channel.mjs').StreamSink<Chunk, Result>} */
  const sink = createStream(() => {
    if (id === null || !pending.delete(id)) return;
    send({ t: 'cancel', id });
  });
  id = request(cap, op, input, {
    chunk: (data) => sink.push(/** @type {Chunk} */ (data)),
    resolve: (value) => sink.finish(/** @type {Result} */ (value)),
    reject: sink.fail,
  });
  return sink.handle;
}

/**
 * Routes a `capChunk` or `capResult` to the request it answers; late replies to cancelled
 * requests are dropped.
 * @param {Extract<ParentMessage, { t: 'capChunk' | 'capResult' }>} message
 */
export function answerCap(message) {
  const handlers = pending.get(message.id);
  if (!handlers) return;
  if (message.t === 'capChunk') {
    handlers.chunk(fromWire(message.data));
    return;
  }
  pending.delete(message.id);
  if (message.ok) handlers.resolve(fromWire(message.value));
  else handlers.reject(new WireFailure(message.error.code, message.error.message));
}
