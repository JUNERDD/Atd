import {
  isRecord,
  readJson,
  report,
  stringArray,
  stringRecord,
  type AdapterContext,
} from './context.js';
import { acceptServer, invalid, type ServerResult } from './mcp-common.js';
import { normalizeRelative } from './paths.js';
import { isLoopbackHost, parseAbsoluteUrl } from './url.js';

const MCP_PATH = 'mcp.json';
const STDIO_KEYS = new Set(['type', 'command', 'args', 'env', 'cwd']);
const HTTP_KEYS = new Set(['type', 'url', 'headers']);
const RESERVED_ENV = new Set(['PLUGIN_ROOT', 'PLUGIN_DATA']);

/**
 * Loads Agent Plugins `mcp.json`. `schemaVersion` is the plugin.json schema version; the MCP
 * schema should match it. Each bad server is skipped with a diagnostic.
 */
export async function loadAgentPluginsMcp(
  ctx: AdapterContext,
  schemaVersion: string,
): Promise<void> {
  const document = await readJson(ctx, MCP_PATH);
  if (document === undefined) return;
  if (!isRecord(document)) {
    report(ctx, 'warning', 'invalid-component', 'mcp.json must be a JSON object.', {
      path: MCP_PATH,
    });
    return;
  }
  const expected = `https://agent-plugins.org/schemas/${schemaVersion}/mcp.schema.json`;
  if (document.$schema !== expected) {
    report(
      ctx,
      'warning',
      'unknown-field',
      `mcp.json should declare "$schema": "${expected}"; loaded with the plugin's schema rules.`,
      { path: MCP_PATH },
    );
  }
  for (const key of Object.keys(document)) {
    if (key === '$schema' || key === 'mcpServers') continue;
    report(ctx, 'warning', 'unknown-field', `mcp.json field "${key}" is not defined; ignored.`, {
      path: MCP_PATH,
    });
  }
  const servers = document.mcpServers;
  if (servers === undefined) return;
  if (!isRecord(servers)) {
    report(ctx, 'warning', 'invalid-component', '"mcpServers" must be an object.', {
      path: MCP_PATH,
    });
    return;
  }
  for (const [rawName, entry] of Object.entries(servers)) {
    acceptServer(ctx, rawName, MCP_PATH, readServer(ctx, rawName, entry));
  }
}

function readServer(ctx: AdapterContext, rawName: string, entry: unknown): ServerResult {
  if (!isRecord(entry)) return invalid('the entry must be an object.');
  const type = entry.type;
  if (type !== 'stdio' && type !== 'streamable-http' && type !== 'sse') {
    return invalid('"type" must be "stdio", "streamable-http" or "sse".');
  }
  const allowed = type === 'stdio' ? STDIO_KEYS : HTTP_KEYS;
  for (const key of Object.keys(entry)) {
    if (allowed.has(key)) continue;
    report(ctx, 'warning', 'unknown-field', `MCP server "${rawName}" field "${key}" is ignored.`, {
      path: MCP_PATH,
    });
  }
  return type === 'stdio' ? readStdio(entry) : readHttp(entry, type);
}

/** A bare executable name, or a `./` path inside the plugin root; never a shell string. */
function readCommand(value: unknown): ServerResult | string {
  if (typeof value !== 'string' || value === '') return invalid('"command" must be a string.');
  if (value.startsWith('./')) {
    if (/\s/.test(value)) return invalid('"command" must be a single path without arguments.');
    const path = normalizeRelative(value);
    if (path === null) {
      return {
        ok: false,
        problem: { code: 'path-escape', message: '"command" leaves the plugin root.' },
      };
    }
    return path === '' ? invalid('"command" must name a file.') : value;
  }
  if (/[\s/\\]/.test(value)) {
    return invalid('"command" must be a bare executable name or a "./" path inside the plugin.');
  }
  return value;
}

/** `./dir`, `${PLUGIN_ROOT}[/dir]` or `${PLUGIN_DATA}[/dir]`. */
function readCwd(value: string): ServerResult | string {
  const variable = /^\$\{PLUGIN_(?:ROOT|DATA)\}(\/.*)?$/.exec(value);
  const rest = variable ? (variable[1] ?? '') : value.startsWith('./') ? value : null;
  if (rest === null)
    return invalid('"cwd" must start with "./", "${PLUGIN_ROOT}" or "${PLUGIN_DATA}".');
  if (normalizeRelative(rest.replace(/^\//, '')) === null) {
    return {
      ok: false,
      problem: { code: 'path-escape', message: '"cwd" leaves its base directory.' },
    };
  }
  return value;
}

function readStdio(entry: Record<string, unknown>): ServerResult {
  const command = readCommand(entry.command);
  if (typeof command !== 'string') return command;
  const args = entry.args === undefined ? [] : stringArray(entry.args);
  if (args === null) return invalid('"args" must be an array of strings.');
  const env = entry.env === undefined ? {} : stringRecord(entry.env);
  if (env === null) return invalid('"env" must map names to strings.');
  const reserved = Object.keys(env).find((key) => RESERVED_ENV.has(key));
  if (reserved !== undefined)
    return invalid(`"env" must not set ${reserved}; the host provides it.`);
  if (entry.cwd !== undefined && typeof entry.cwd !== 'string') {
    return invalid('"cwd" must be a string.');
  }
  const cwd = entry.cwd === undefined ? undefined : readCwd(entry.cwd);
  if (cwd !== undefined && typeof cwd !== 'string') return cwd;
  return {
    ok: true,
    transport: { type: 'stdio', command, args, env, ...(cwd === undefined ? {} : { cwd }) },
  };
}

function readHttp(
  entry: Record<string, unknown>,
  protocol: 'streamable-http' | 'sse',
): ServerResult {
  if (typeof entry.url !== 'string') return invalid('"url" must be a string.');
  const url = parseAbsoluteUrl(entry.url);
  if (url === null) return invalid('"url" must be an absolute URL.');
  if (url.hasUserinfo || url.hasFragment) {
    return invalid('"url" must not contain credentials or a fragment.');
  }
  const secure = url.scheme === 'https' || (url.scheme === 'http' && isLoopbackHost(url.host));
  if (!secure) return invalid('"url" must use https unless it points at a loopback host.');
  const headers = entry.headers === undefined ? {} : stringRecord(entry.headers);
  if (headers === null) return invalid('"headers" must map names to strings.');
  return { ok: true, transport: { type: 'http', protocol, url: entry.url, headers } };
}
