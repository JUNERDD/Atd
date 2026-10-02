import { createRequire } from 'node:module';
import { realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';

/**
 * Loads the pinned `@juicesharp/rpiv-todo` extension. The package ships TypeScript only (its
 * `index.ts` uses a top-level await), so it goes through jiti as pi-hermes-memory does
 * (memory/authority.ts). Its config and i18n dependencies are aliased to project stubs next to this
 * file: the real `@juicesharp/rpiv-config` would read `~/.config/rpiv-todo`, and the optional
 * `@juicesharp/rpiv-i18n` peer is not part of the service.
 */

const RPIV_TODO = '@juicesharp/rpiv-todo';
const RPIV_TODO_VERSION = '2.12.0';

/** rpiv-todo's default export: registers the `todo` tool, `/todos` and its session handlers. */
export type RpivTodoFactory = (pi: ExtensionAPI) => void;

let cached: Promise<RpivTodoFactory> | null = null;

/**
 * Stub modules sit next to this file with its own extension: `.ts` when the service runs from
 * source (tests), `.js` from the compiled `dist/`.
 */
function stubPath(name: string): string {
  const self = fileURLToPath(import.meta.url);
  return path.join(path.dirname(self), `${name}${path.extname(self)}`);
}

/**
 * One jiti instance for the process: rpiv-todo keeps per-session todo state in a module-level
 * map keyed by Pi session id, so every task's session must share one module instance.
 */
function createLoader() {
  const i18n = stubPath('rpiv-i18n-stub');
  return createJiti(import.meta.url, {
    moduleCache: true,
    fsCache: true,
    alias: {
      '@juicesharp/rpiv-config': stubPath('rpiv-config-stub'),
      '@juicesharp/rpiv-i18n/loader': i18n,
      '@juicesharp/rpiv-i18n': i18n,
    },
  });
}

async function importFactory(): Promise<RpivTodoFactory> {
  // No `exports` map and no JS entry: resolve the manifest, then load `index.ts` beside it.
  // Realpath so jiti resolves the package's own dependencies from its pnpm location.
  const manifest = await realpath(
    createRequire(import.meta.url).resolve(`${RPIV_TODO}/package.json`),
  );
  const pkg: unknown = JSON.parse(await readFile(manifest, 'utf8'));
  const version = isRecord(pkg) ? pkg['version'] : undefined;
  if (version !== RPIV_TODO_VERSION) {
    throw new Error(
      `${RPIV_TODO} ${String(version)} is not the verified ${RPIV_TODO_VERSION} pin; refusing to load it.`,
    );
  }
  const entry = pathToFileURL(path.join(path.dirname(manifest), 'index.ts')).href;
  const mod: unknown = await createLoader().import(entry);
  const factory = isRecord(mod) ? mod['default'] : undefined;
  if (typeof factory !== 'function') throw new Error(`${RPIV_TODO} has no default export.`);
  // Only `pi` is passed: the optional second parameter (overlay importer) keeps its default.
  return (pi) => {
    Reflect.apply(factory, undefined, [pi]);
  };
}

/** The rpiv-todo extension factory, loaded once per process; a failed load is retried next time. */
export function loadRpivTodo(): Promise<RpivTodoFactory> {
  cached ??= importFactory().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
