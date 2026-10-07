// @ts-check
/**
 * Entry of an app backend child: `node --permission … bootstrap.mjs <versionDir>`, inside the
 * backend Seatbelt profile, with cwd = the app's data directory and an IPC channel to the service
 * (`backendSpawnSpec` in src/node/backend.ts). It loads the version's single-file backend
 * (`server/index.mjs`, whose default export is a `defineBackend` result), runs `onStart`, reports
 * `ready`, then serves `call`, `widget` and `cancel` requests until the service stops it. Any
 * uncaught error is logged to the service and ends the process with a nonzero code so the service
 * records a crash.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createContext } from './context.mjs';
import { answerCap, send, toWireError, WireFailure } from './ipc.mjs';
import { fromWire, toWire } from './wire.mjs';

/** @typedef {import('../src/sdk/server/types.ts').BackendDefinition} BackendDefinition */
/** @typedef {import('../src/sdk/server/types.ts').BackendContext} BackendContext */
/** @typedef {import('../src/contracts.ts').AppParentMessage} ParentMessage */

const STOP_TIMEOUT_MS = 5000;

/** Reports a fatal error and exits nonzero once the report is out (or after a second). */
function fatal(/** @type {unknown} */ error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  const exit = () => process.exit(1);
  setTimeout(exit, 1000).unref();
  try {
    process.send?.({ t: 'log', level: 'error', message: message.slice(0, 16000) }, exit);
  } catch {
    exit();
  }
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

/** @param {unknown} value @returns {value is BackendDefinition} */
function isBackend(value) {
  if (value === null || typeof value !== 'object') return false;
  const api = Reflect.get(value, 'api');
  return api !== null && typeof api === 'object';
}

/** @param {unknown} value @returns {value is AsyncIterable<unknown>} */
function isAsyncIterable(value) {
  return value !== null && typeof value === 'object' && Symbol.asyncIterator in value;
}

const versionDir = process.argv[2];
if (!versionDir || !process.send) {
  throw new Error('Usage: bootstrap.mjs <versionDir>, spawned with an IPC channel.');
}
const entry = path.join(versionDir, 'server', 'index.mjs');
const loaded = await import(pathToFileURL(entry).href);
const backend = loaded.default;
if (!isBackend(backend)) {
  throw new Error('server/index.ts must `export default defineBackend({ api: { … } })`.');
}

const { ctx, close } = createContext({
  appId: process.env.ATD_APP_ID ?? '',
  dataDir: fs.realpathSync.native(process.cwd()),
});
const widgets = new Map((backend.widgets ?? []).map((widget) => [widget.id, widget]));
/** In-flight `call` and `widget` requests by id, so `cancel` can abort them. */
const inflight = new Map();

/**
 * Runs one api function. A plain value becomes the result; an async iterable streams its items
 * as chunks when the caller asked for a stream (its generator return value is the result), or
 * is collected into an array otherwise.
 * @param {Extract<ParentMessage, { t: 'call' }>} message
 */
async function serveCall(message) {
  const controller = new AbortController();
  inflight.set(message.id, controller);
  try {
    const fn = Object.hasOwn(backend.api, message.name) ? backend.api[message.name] : undefined;
    if (typeof fn !== 'function')
      throw new WireFailure('not_found', `No api function "${message.name}".`);
    /** @type {BackendContext & { signal: AbortSignal }} */
    const callCtx = Object.create(ctx, { signal: { value: controller.signal } });
    const output = await Reflect.apply(fn, backend.api, [fromWire(message.input), callCtx]);
    let value = output;
    if (isAsyncIterable(output)) {
      const iterator = output[Symbol.asyncIterator]();
      const chunks = [];
      for (;;) {
        if (controller.signal.aborted) {
          await iterator.return?.();
          throw new WireFailure('cancelled', 'The call was cancelled.');
        }
        const step = await iterator.next();
        if (step.done) {
          value = message.stream ? step.value : chunks;
          break;
        }
        if (message.stream) send({ t: 'chunk', id: message.id, data: toWire(step.value) });
        else chunks.push(step.value);
      }
    }
    send({ t: 'result', id: message.id, ok: true, value: toWire(value ?? null) });
  } catch (error) {
    send({ t: 'result', id: message.id, ok: false, error: toWireError(error, 'app_error') });
  } finally {
    inflight.delete(message.id);
  }
}

/** @param {Extract<ParentMessage, { t: 'widget' }>} message */
async function serveWidget(message) {
  try {
    const widget = widgets.get(message.widgetId);
    if (!widget) throw new WireFailure('not_found', `No widget "${message.widgetId}".`);
    const timeline = await widget.render(ctx, { family: message.family, config: message.config });
    // The service validates the timeline against the widget schema and drops an invalid one.
    send({ t: 'result', id: message.id, ok: true, value: timeline });
  } catch (error) {
    send({ t: 'result', id: message.id, ok: false, error: toWireError(error, 'widget_error') });
  }
}

let stopping = false;
/** Runs `onStop` (bounded), closes storage and exits; the service's SIGTERM or disconnect. */
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const controller of inflight.values()) controller.abort();
  try {
    await Promise.race([
      Promise.resolve(backend.onStop?.(ctx)),
      new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS).unref()),
    ]);
  } finally {
    close();
    process.exit(0);
  }
}

process.on('message', (/** @type {ParentMessage} */ message) => {
  switch (message.t) {
    case 'call':
      void serveCall(message);
      return;
    case 'widget':
      void serveWidget(message);
      return;
    case 'cancel':
      inflight.get(message.id)?.abort();
      return;
    case 'capChunk':
    case 'capResult':
      answerCap(message);
      return;
  }
});
process.on('SIGTERM', () => void stop());
process.on('disconnect', () => void stop());

await backend.onStart?.(ctx);
send({
  t: 'ready',
  api: Object.keys(backend.api),
  widgets: [...widgets.values()].map(({ id, title, description, families, refreshMinutes }) => ({
    id,
    title,
    description,
    families,
    refreshMinutes,
  })),
});
