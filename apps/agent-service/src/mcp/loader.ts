import { createRequire } from 'node:module';
import { realpath, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createJiti } from 'jiti';
import type {
  AdapterAuthFlow,
  AdapterFactory,
  AdapterInternals,
  AdapterManagerClass,
  AdapterModuleSource,
} from './adapter-types.js';

/**
 * Adapter loading: the service consumes its direct `pi-mcp-adapter 2.38.0`
 * dependency through jiti (TS root, no static import). A single shared jiti
 * instance keeps module identity so host seams observe the control
 * session's live manager.
 */

export class McpAdapterMissing extends Error {
  constructor(
    readonly searched: string[],
    detail: string,
  ) {
    super(`pi-mcp-adapter 2.38.0 is unavailable: ${detail}`);
    this.name = 'McpAdapterMissing';
  }
}

let sharedJiti: ReturnType<typeof createJiti> | null = null;
let cached: Promise<AdapterInternals> | null = null;
let injected: AdapterInternals | null = null;

/**
 * `fsCache` stays on (jiti's default): transpiling the adapter costs 894 ms
 * cold against 328 ms from the cache, and it is the bulk of the first MCP
 * operation. jiti keys each entry by a content hash and falls back to a plain
 * transpile on a miss, so no manual version key is needed; it also disables
 * the cache itself when the directory is not writable
 * (`node_modules/.cache/jiti`, else `{TMP_DIR}/jiti`).
 */
function jiti() {
  if (!sharedJiti) sharedJiti = createJiti(import.meta.url, { moduleCache: true, fsCache: true });
  return sharedJiti;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Resolves the adapter directory from the direct service dependency. */
export async function resolveAdapterDir(): Promise<{
  dir: string;
  source: AdapterModuleSource;
  searched: string[];
}> {
  const searched: string[] = [];
  const override = process.env.AI_AGENT_MCP_ADAPTER_PATH?.trim();
  if (override) {
    searched.push(override);
    const dir = (await exists(path.join(override, 'package.json')))
      ? override
      : path.dirname(override);
    if (await exists(path.join(dir, 'package.json'))) {
      // Realpath: jiti resolves the adapter's own deps from the module path,
      // and pnpm siblings exist only under the realpath.
      return { dir: await realpath(dir), source: 'env-override', searched };
    }
    throw new McpAdapterMissing(
      searched,
      `AI_AGENT_MCP_ADAPTER_PATH does not resolve: ${override}.`,
    );
  }
  try {
    // The adapter's exports map hides `./package.json`, so resolve the
    // package entry (`.`) and take its directory as the package root.
    const entry = createRequire(import.meta.url).resolve('pi-mcp-adapter');
    const dir = path.dirname(entry);
    if (await exists(path.join(dir, 'package.json'))) {
      return { dir: await realpath(dir), source: 'bare-specifier', searched };
    }
    searched.push('<bare pi-mcp-adapter>');
  } catch {
    searched.push('<bare pi-mcp-adapter>');
  }
  throw new McpAdapterMissing(
    searched,
    'no adapter install found (need direct pi-mcp-adapter 2.38.0).',
  );
}

/** Loads adapter modules through the shared jiti instance. */
export function loadAdapterInternals(): Promise<AdapterInternals> {
  if (injected) return Promise.resolve(injected);
  if (cached) return cached;
  cached = (async () => {
    const { dir, source, searched } = await resolveAdapterDir();
    try {
      return await importFromDir(dir, source);
    } catch (error) {
      cached = null;
      if (error instanceof McpAdapterMissing) throw error;
      throw new McpAdapterMissing(searched, error instanceof Error ? error.message : String(error));
    }
  })();
  return cached;
}

async function importFromDir(dir: string, source: AdapterModuleSource): Promise<AdapterInternals> {
  const loader = jiti();
  const url = (file: string) => pathToFileURL(path.join(dir, file)).href;
  const index = asRecord(await loader.import(url('index.ts')));
  const managerMod = asRecord(await loader.import(url('server-manager.ts')));
  const authMod = asRecord(await loader.import(url('mcp-auth-flow.ts')));
  const typesMod = asRecord(await loader.import(url('types.ts')));
  const validatorMod = asRecord(await loader.import(url('json-schema-validator.ts')));
  let utilsMod: Record<string, unknown> = {};
  try {
    utilsMod = asRecord(await loader.import(url('utils.ts')));
  } catch {
    utilsMod = {};
  }
  const version = await readVersion(dir);
  if (version !== '2.38.0') {
    throw new Error(
      `adapter version ${version} is not the verified 2.38.0 pin; refusing to float.`,
    );
  }
  return {
    source,
    dir,
    version,
    createMcpAdapter: asFunction(
      index['createMcpAdapter'],
      'createMcpAdapter',
    ) as unknown as AdapterFactory,
    McpServerManager: asFunction(
      managerMod['McpServerManager'],
      'McpServerManager',
    ) as unknown as AdapterManagerClass,
    authFlow: {
      startAuth: asFunction(
        authMod['startAuth'],
        'startAuth',
      ) as unknown as AdapterAuthFlow['startAuth'],
      completeAuthFromInput: asFunction(
        authMod['completeAuthFromInput'],
        'completeAuthFromInput',
      ) as unknown as AdapterAuthFlow['completeAuthFromInput'],
      getAuthStatus: asFunction(
        authMod['getAuthStatus'],
        'getAuthStatus',
      ) as unknown as AdapterAuthFlow['getAuthStatus'],
      removeAuth: asFunction(
        authMod['removeAuth'],
        'removeAuth',
      ) as unknown as AdapterAuthFlow['removeAuth'],
      supportsOAuth: asFunction(
        authMod['supportsOAuth'],
        'supportsOAuth',
      ) as unknown as AdapterAuthFlow['supportsOAuth'],
      ...(typeof authMod['createOAuthRuntime'] === 'function'
        ? {
            createOAuthRuntime: authMod[
              'createOAuthRuntime'
            ] as AdapterAuthFlow['createOAuthRuntime'],
          }
        : {}),
    },
    approvalEvent: asString(
      typesMod['MCP_TOOL_APPROVAL_REQUEST_EVENT'],
      'MCP_TOOL_APPROVAL_REQUEST_EVENT',
    ),
    isServerDisabled: asFunction(
      typesMod['isServerDisabled'],
      'isServerDisabled',
    ) as unknown as AdapterInternals['isServerDisabled'],
    ...(typeof index['registerMcpServer'] === 'function'
      ? { registerMcpServer: index['registerMcpServer'] as AdapterInternals['registerMcpServer'] }
      : {}),
    createJsonSchemaValidator: asFunction(
      validatorMod['createJsonSchemaValidator'],
      'createJsonSchemaValidator',
    ) as unknown as AdapterInternals['createJsonSchemaValidator'],
    ...(typeof utilsMod['normalizeDirectToolInputSchema'] === 'function'
      ? {
          normalizeDirectToolInputSchema: utilsMod[
            'normalizeDirectToolInputSchema'
          ] as AdapterInternals['normalizeDirectToolInputSchema'],
        }
      : {}),
  };
}

async function readVersion(dir: string): Promise<string> {
  const loader = jiti();
  const pkg = asRecord(await loader.import(pathToFileURL(path.join(dir, 'package.json')).href));
  return typeof pkg['version'] === 'string' ? pkg['version'] : 'unknown';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null)
    throw new Error('Adapter module shape is unexpected.');
  return value as Record<string, unknown>;
}

function asFunction(value: unknown, name: string): (...args: never[]) => unknown {
  if (typeof value !== 'function') throw new Error(`Adapter export ${name} is missing.`);
  return value as (...args: never[]) => unknown;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Adapter export ${name} is missing.`);
  return value;
}

/** Test seam: injects mock internals; production code paths stay identical. */
export function setAdapterInternalsForTests(internals: AdapterInternals | null): void {
  injected = internals;
  if (internals) cached = Promise.resolve(internals);
  else cached = null;
}

/** Test seam: drops cached internals and the shared jiti registry. */
export function forgetAdapterForTests(): void {
  injected = null;
  cached = null;
  sharedJiti = null;
}

/**
 * Scopes the adapter's filesystem footprint (metadata cache, OAuth store)
 * under the service dataDir when the deployment left the env unset. The
 * service process owns these vars; explicit deployment values always win.
 */
export function scopeAdapterEnv(dataDir: string): () => void {
  const scoped: string[] = [];
  const ensure = (key: string, value: string) => {
    if (process.env[key] === undefined) {
      scoped.push(key);
      process.env[key] = value;
    }
  };
  ensure('PI_CODING_AGENT_DIR', path.join(dataDir, 'pi-agent'));
  ensure('MCP_OAUTH_DIR', path.join(dataDir, 'mcp-oauth'));
  return () => {
    for (const key of scoped) delete process.env[key];
  };
}
