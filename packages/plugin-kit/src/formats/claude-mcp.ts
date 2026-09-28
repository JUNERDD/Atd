import {
  isRecord,
  readJson,
  report,
  reportEscape,
  statPath,
  stringArray,
  stringRecord,
  type AdapterContext,
} from './context.js';
import { acceptServer, invalid, unsupported, type ServerResult } from './mcp-common.js';
import { readManifestPath } from './paths.js';
import { parseAbsoluteUrl } from './url.js';

const MANIFEST = '.claude-plugin/plugin.json';
const DEFAULT_FILE = '.mcp.json';

/** Server declarations by source name; a later declaration replaces an earlier one (Claude). */
type Declared = Map<string, { path: string; result: ServerResult }>;

/**
 * Loads `.mcp.json` first, then each manifest `mcpServers` shape in order (file path, inline map,
 * or an array of them). Values stay unsubstituted.
 */
export async function loadClaudeMcp(ctx: AdapterContext, declared: unknown): Promise<void> {
  const servers: Declared = new Map();
  if ((await statPath(ctx, DEFAULT_FILE)) === 'file') {
    mergeFile(ctx, servers, DEFAULT_FILE, await readJson(ctx, DEFAULT_FILE));
  }
  const shapes = declared === undefined ? [] : Array.isArray(declared) ? declared : [declared];
  for (const shape of shapes as unknown[]) {
    if (isRecord(shape)) mergeMap(servers, MANIFEST, shape);
    else if (typeof shape === 'string') await mergePath(ctx, servers, shape);
    else {
      report(
        ctx,
        'warning',
        'invalid-component',
        '"mcpServers" entries must be paths or objects.',
        {
          path: MANIFEST,
        },
      );
    }
  }
  for (const [rawName, { path, result }] of servers) acceptServer(ctx, rawName, path, result);
}

async function mergePath(ctx: AdapterContext, servers: Declared, raw: string): Promise<void> {
  if (/\.(mcpb|dxt)$/i.test(raw) || raw.startsWith('https://')) {
    report(
      ctx,
      'warning',
      'unsupported-transport',
      `MCP bundle "${raw}" is not supported; its servers are skipped.`,
      { path: MANIFEST },
    );
    return;
  }
  const resolved = readManifestPath(raw);
  if (!resolved.ok) {
    if (resolved.reason === 'escape') reportEscape(ctx, raw);
    else invalidPath(ctx, raw);
    return;
  }
  const document = await readJson(ctx, resolved.path);
  if (document !== undefined) mergeFile(ctx, servers, resolved.path, document);
}

function invalidPath(ctx: AdapterContext, raw: string): void {
  report(ctx, 'warning', 'invalid-component', `Manifest path "${raw}" must start with "./".`, {
    path: MANIFEST,
  });
}

/** An MCP config file holds `{ mcpServers: {...} }` or the server map at the top level. */
function mergeFile(ctx: AdapterContext, servers: Declared, path: string, document: unknown): void {
  if (document === undefined) return;
  if (!isRecord(document)) {
    report(ctx, 'warning', 'invalid-component', `"${path}" must be a JSON object.`, { path });
    return;
  }
  mergeMap(servers, path, isRecord(document.mcpServers) ? document.mcpServers : document);
}

function mergeMap(servers: Declared, path: string, map: Record<string, unknown>): void {
  for (const [rawName, entry] of Object.entries(map)) {
    servers.set(rawName, { path, result: readServer(entry) });
  }
}

/**
 * Claude server entries: no `type` or `stdio` → stdio; `http` / `streamable-http` / `sse` →
 * remote. `ws` and any entry using `headersHelper` or `oauth` have no normalized form.
 */
export function readServer(entry: unknown): ServerResult {
  if (!isRecord(entry)) return invalid('the entry must be an object.');
  if (entry.headersHelper !== undefined || entry.oauth !== undefined) {
    return unsupported('"headersHelper" and "oauth" authentication are not supported.');
  }
  const type = entry.type ?? 'stdio';
  if (type === 'stdio') return readStdio(entry);
  if (type === 'http' || type === 'streamable-http') return readRemote(entry, 'streamable-http');
  if (type === 'sse') return readRemote(entry, 'sse');
  if (type === 'ws') return unsupported('WebSocket servers are not supported.');
  return invalid(`unknown "type" ${JSON.stringify(type)}.`);
}

function readStdio(entry: Record<string, unknown>): ServerResult {
  if (typeof entry.command !== 'string' || entry.command.trim() === '') {
    return invalid('"command" must be a non-empty string.');
  }
  const args = entry.args === undefined ? [] : stringArray(entry.args);
  if (args === null) return invalid('"args" must be an array of strings.');
  const env = entry.env === undefined ? {} : stringRecord(entry.env);
  if (env === null) return invalid('"env" must map names to strings.');
  if (entry.cwd !== undefined && typeof entry.cwd !== 'string') {
    return invalid('"cwd" must be a string.');
  }
  return {
    ok: true,
    transport: {
      type: 'stdio',
      command: entry.command,
      args,
      env,
      ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
    },
  };
}

function readRemote(
  entry: Record<string, unknown>,
  protocol: 'streamable-http' | 'sse',
): ServerResult {
  const url = entry.url;
  if (typeof url !== 'string') return invalid('"url" must be a string.');
  // A URL built from `${VAR}` is only checkable after substitution.
  if (!url.includes('${')) {
    const parsed = parseAbsoluteUrl(url);
    if (parsed === null || (parsed.scheme !== 'http' && parsed.scheme !== 'https')) {
      return invalid('"url" must be an absolute http(s) URL.');
    }
  }
  const headers = entry.headers === undefined ? {} : stringRecord(entry.headers);
  if (headers === null) return invalid('"headers" must map names to strings.');
  return { ok: true, transport: { type: 'http', protocol, url, headers } };
}
