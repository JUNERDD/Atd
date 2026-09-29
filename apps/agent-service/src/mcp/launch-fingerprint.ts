import { createHmac } from 'node:crypto';
import path from 'node:path';
import type { McpLaunchKind, McpServerConfig } from '@ai/agent-contracts';
import type { AdapterServerEntry } from './adapter-types.js';

/**
 * What a launch approval binds (G1): a keyed digest of everything that decides what a server runs
 * or where a service env value goes, computed from the adapter entry the connect path would hand
 * the adapter. Env values enter only as their own keyed digests, so neither the fingerprint nor
 * anything derived from it can be used to test a guessed value without the profile's key.
 */

/** A plugin server's plugin as its fingerprint binds it; any update is a new revision. */
export interface LaunchPlugin {
  id: string;
  revision: string;
}

/**
 * Which approval a server needs: every stdio server runs a local command; an HTTP server whose
 * bearer token comes from a service env var sends that value to its URL. Other HTTP servers need
 * none (`null`).
 */
export function launchKind(record: McpServerConfig): McpLaunchKind | null {
  if (record.stdio) return 'mcp-stdio';
  const auth = record.http?.auth;
  return auth?.type === 'bearer' && auth.tokenEnv.trim() ? 'mcp-http-env' : null;
}

/** The absolute directory a stdio launch starts in; the service's own when the record names none. */
export function launchCwd(entry: AdapterServerEntry, defaultCwd: string): string {
  return path.resolve(defaultCwd, entry.cwd ?? defaultCwd);
}

/** Env keys that change what a runtime loads or where it looks for code. */
const RISKY_ENV = new Set([
  'PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONSTARTUP',
  'PERL5OPT',
  'PERL5LIB',
  'RUBYOPT',
  'RUBYLIB',
  'BASH_ENV',
  'ENV',
  'JAVA_TOOL_OPTIONS',
]);

export function isRiskyEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return RISKY_ENV.has(upper) || upper.startsWith('DYLD_') || upper.startsWith('LD_');
}

/**
 * The fingerprint of one launch. `entry` must come from the connect path's own accessor
 * (`ConnectionManager.launchEntry`), so the resolved command, arguments, cwd and env values are
 * exactly what would run. Throws for a server that needs no approval.
 */
export function launchFingerprint(
  key: Buffer,
  input: {
    record: McpServerConfig;
    entry: AdapterServerEntry;
    plugin: LaunchPlugin | null;
    defaultCwd: string;
  },
): string {
  const { record, entry, plugin, defaultCwd } = input;
  const digest = (value: string) => createHmac('sha256', key).update(value).digest('hex');
  const kind = launchKind(record);
  const common = { v: 1, kind, serverId: record.serverId, plugin };
  if (kind === 'mcp-stdio' && record.stdio) {
    return digest(
      canonical({
        ...common,
        command: record.stdio.command,
        resolvedCommand: entry.command ?? null,
        args: entry.args ?? [],
        cwd: launchCwd(entry, defaultCwd),
        env: sortedEntries(entry.env ?? {}).map(([name, value]) => [name, digest(value)]),
        // The adapter inherits the service environment unless told otherwise.
        inheritEnv: entry.inheritEnv !== false,
      }),
    );
  }
  if (kind === 'mcp-http-env' && record.http?.auth.type === 'bearer') {
    const url = new URL(entry.url ?? record.http.url);
    return digest(
      canonical({
        ...common,
        url: `${url.origin}${url.pathname}`,
        tokenEnv: record.http.auth.tokenEnv,
        headerKeys: Object.keys(entry.headers ?? {}).sort(),
      }),
    );
  }
  throw new Error(`MCP server ${record.serverId} needs no launch approval.`);
}

function byName([a]: [string, unknown], [b]: [string, unknown]): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedEntries(values: Record<string, string>): [string, string][] {
  return Object.entries(values).sort(byName);
}

/** JSON with object keys sorted at every level, so equal content always digests alike. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const fields = Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .sort(byName);
    return `{${fields.map(([name, field]) => `${JSON.stringify(name)}:${canonical(field)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
