// @ts-check
/**
 * The `ctx` an app backend gets. Storage (db, kv, files) and logging run here in the child, on
 * `node:sqlite` and `fs` inside the data directory, which is all the sandbox lets it write; ai,
 * agent, memory, mcp and web go to the service's capability proxy over IPC, where grants are
 * checked and credentials stay.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { format } from 'node:util';
import { capCall, capStream, send } from './ipc.mjs';
import { fromWire, toWire } from './wire.mjs';

/** @typedef {import('../src/sdk/server/types.ts').BackendContext} BackendContext */
/** @typedef {import('../src/sdk/server/types.ts').KeyValueStore} KeyValueStore */
/** @typedef {import('../src/sdk/server/types.ts').AppFiles} AppFiles */

const LOG_MAX = 16000;

/** @param {'info' | 'warn' | 'error'} level @param {unknown[]} args */
function log(level, args) {
  send({ t: 'log', level, message: format(...args).slice(0, LOG_MAX) });
}

/** @param {string} dataDir @returns {{ store: KeyValueStore, close: () => void }} */
function openKv(dataDir) {
  /** @type {DatabaseSync | null} */
  let db = null;
  const open = () => {
    if (db) return db;
    db = new DatabaseSync(path.join(dataDir, 'kv.db'));
    db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    return db;
  };
  return {
    store: {
      get(key) {
        const row = open().prepare('SELECT value FROM kv WHERE key = ?').get(key);
        return row ? fromWire(JSON.parse(String(row.value))) : undefined;
      },
      set(key, value) {
        const json = JSON.stringify(toWire(value) ?? null);
        open()
          .prepare(
            'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          )
          .run(key, json);
      },
      delete(key) {
        return Number(open().prepare('DELETE FROM kv WHERE key = ?').run(key).changes) > 0;
      },
      keys(prefix = '') {
        const rows = open()
          .prepare('SELECT key FROM kv WHERE substr(key, 1, length(?)) = ? ORDER BY key')
          .all(prefix, prefix);
        return rows.map((row) => String(row.key));
      },
    },
    close: () => db?.close(),
  };
}

/**
 * Files under `<dataDir>/files`. The sandbox already confines writes to the data directory; this
 * also keeps paths inside `files/` and refuses symlinks so apps get one predictable root.
 * @param {string} dataDir
 * @returns {AppFiles}
 */
function openFiles(dataDir) {
  const root = path.join(dataDir, 'files');
  fs.mkdirSync(root, { recursive: true });
  const realRoot = fs.realpathSync.native(root);
  /** @param {string} file */
  const inside = (file) => file.startsWith(realRoot + path.sep) || file === realRoot;
  /** @param {string} relative @param {boolean} [create] */
  const resolve = (relative, create = false) => {
    if (
      typeof relative !== 'string' ||
      !relative ||
      relative.includes('\0') ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Invalid file path: ${JSON.stringify(relative)}.`);
    }
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep))
      throw new Error(`"${relative}" is outside the app's files.`);
    if (create) fs.mkdirSync(path.dirname(target), { recursive: true });
    let existing = path.dirname(target);
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    if (!inside(fs.realpathSync.native(existing))) {
      throw new Error(`"${relative}" is outside the app's files.`);
    }
    if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`"${relative}" is a symbolic link.`);
    }
    return target;
  };
  return {
    read: (relative) => new Uint8Array(fs.readFileSync(resolve(relative))),
    readText: (relative) => fs.readFileSync(resolve(relative), 'utf8'),
    write: (relative, data) => fs.writeFileSync(resolve(relative, true), data),
    delete(relative) {
      const target = resolve(relative);
      if (!fs.existsSync(target)) return false;
      fs.rmSync(target, { recursive: true });
      return true;
    },
    exists: (relative) => fs.existsSync(resolve(relative)),
    list(dir) {
      const target = dir === undefined || dir === '' ? root : resolve(dir);
      return fs
        .readdirSync(target, { withFileTypes: true })
        .filter((entry) => entry.isFile() || entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size: entry.isFile() ? fs.statSync(path.join(target, entry.name)).size : 0,
        }));
    },
  };
}

/**
 * @param {{ appId: string, dataDir: string }} options
 * @returns {{ ctx: BackendContext, close: () => void }}
 */
export function createContext({ appId, dataDir }) {
  /** @type {DatabaseSync | null} */
  let db = null;
  const kv = openKv(dataDir);
  /** @type {AppFiles | null} */
  let files = null;

  /** @type {BackendContext} */
  const ctx = {
    appId,
    dataDir,
    ai: {
      generate: (input) => capCall('ai', 'generate', input),
      stream: (input) => capStream('ai', 'stream', input),
    },
    agent: { run: (input) => capStream('agent', 'run', input) },
    memory: {
      search: (input) => capCall('memory', 'search', input),
      read: (input) => capCall('memory', 'read', input),
      write: (input) => capCall('memory', 'write', input),
    },
    mcp: {
      listTools: (input) => capCall('mcp', 'listTools', input),
      callTool: (input) => capCall('mcp', 'callTool', input),
    },
    web: {
      search: (input) => capCall('web', 'search', input),
      fetch: (input) => capCall('web', 'fetch', input),
    },
    get db() {
      db ??= new DatabaseSync(path.join(dataDir, 'app.db'));
      return db;
    },
    kv: kv.store,
    get files() {
      files ??= openFiles(dataDir);
      return files;
    },
    events: {
      publish(channel, data) {
        send({ t: 'event', channel, data: toWire(data ?? null) });
      },
    },
    widgets: {
      reload(widgetId) {
        send(widgetId === undefined ? { t: 'widgetReload' } : { t: 'widgetReload', widgetId });
      },
    },
    log: {
      info: (...args) => log('info', args),
      warn: (...args) => log('warn', args),
      error: (...args) => log('error', args),
    },
  };

  return {
    ctx,
    close: () => {
      db?.close();
      kv.close();
    },
  };
}
