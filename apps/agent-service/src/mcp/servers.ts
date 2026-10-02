import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import { McpServerConfigSchema, parse, type McpServerConfig } from '@atd/agent-contracts';
import { KeyringBackend, keyringMcpAccount } from '../credentials/keyring.js';
import { mcpServerKey } from '../credentials/server-keys.js';
import { McpError, type SecretResolver } from './errors.js';
import type { McpLaunchSpec } from './types.js';

/**
 * Service MCP server records: validation, stdio/HTTP diagnostics and the launch spec of a record.
 * Records at rest live in `servers.json` and the keyring (mcp/server-store.ts); bearer tokens
 * resolve at connect time from the keyring (or an explicit env var) into the in-memory resolved
 * launch only (mcp/launch-resolve.ts).
 */

/** The user catalog as a whole: at most 100 servers. */
const ServerListSchema = Type.Object(
  { servers: Type.Array(McpServerConfigSchema, { maxItems: 100 }) },
  { additionalProperties: false },
);

export function serversFile(dataDir: string): string {
  return path.join(dataDir, 'mcp', 'servers.json');
}

/**
 * A configured set with revisions carried over: a new server starts at 1, a changed one bumps,
 * an unchanged one keeps its revision.
 */
export function reviseRecords(
  previous: readonly McpServerConfig[],
  parsed: readonly McpServerConfig[],
): McpServerConfig[] {
  const byId = new Map(previous.map((record) => [record.serverId, record]));
  return parsed.map((candidate) => {
    const old = byId.get(candidate.serverId);
    if (!old) return { ...candidate, revision: 1 };
    const { revision: _a, ...oldRest } = old;
    const { revision: _b, ...newRest } = candidate;
    const changed = JSON.stringify(oldRest) !== JSON.stringify(newRest);
    return { ...candidate, revision: changed ? old.revision + 1 : old.revision };
  });
}

/** Parses + cross-checks server configs (transport halves must match). */
export function parseServerConfigs(input: unknown): McpServerConfig[] {
  const { servers } = parse(ServerListSchema, input);
  const seen = new Set<string>();
  for (const server of servers) {
    if (seen.has(server.serverId)) throw new Error(`Duplicate MCP server ${server.serverId}.`);
    seen.add(server.serverId);
    if (server.transport === 'stdio' && !server.stdio) {
      throw new Error(`MCP server ${server.serverId} needs a stdio command.`);
    }
    if (server.transport !== 'stdio' && !server.http) {
      throw new Error(`MCP server ${server.serverId} needs an HTTP url.`);
    }
    if (server.transport === 'stdio' && server.http) {
      throw new Error(`MCP server ${server.serverId} cannot mix stdio and HTTP.`);
    }
    if (server.http) assertHttpUrl(server.serverId, server.http.url);
    if (server.stdio && !server.stdio.command.trim()) {
      throw new Error(`MCP server ${server.serverId} needs an explicit executable.`);
    }
  }
  return servers;
}

function assertHttpUrl(serverId: string, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`MCP server ${serverId} has an invalid HTTP url.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`MCP server ${serverId} needs an http(s) url.`);
  }
}

/** Redirect classification: loopback needs browser+service locality. */
export function classifyRedirect(
  uri: string | null,
): 'loopback' | 'https-manual' | 'none' | 'invalid' {
  if (!uri) return 'none';
  let parsed: URL;
  try {
    parsed = new URL(uri.replace('{port}', '1'));
  } catch {
    return 'invalid';
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1')
    return 'loopback';
  return parsed.protocol === 'https:' ? 'https-manual' : 'invalid';
}

export interface StdioProbe {
  ok: boolean;
  resolved: string | null;
  searched: string[];
  detail: string;
}

/**
 * Resolves a stdio executable explicitly: absolute paths stat directly,
 * relative paths resolve against cwd, bare names search PATH. Missing
 * runtimes return a diagnostic; the service never falls back to a hidden
 * global `pi`/`npx`.
 */
export async function probeStdioRuntime(
  command: string,
  options: { cwd?: string | null; env?: Record<string, string> } = {},
): Promise<StdioProbe> {
  const searched: string[] = [];
  const trimmed = command.trim();
  if (!trimmed) return { ok: false, resolved: null, searched, detail: 'Empty stdio command.' };
  const isPath = trimmed.includes('/') || trimmed.includes(path.sep);
  if (path.isAbsolute(trimmed) || (isPath && trimmed.startsWith('.'))) {
    const resolved = path.resolve(options.cwd ?? process.cwd(), trimmed);
    searched.push(resolved);
    try {
      const info = await stat(resolved);
      if (!info.isFile())
        return { ok: false, resolved: null, searched, detail: `${resolved} is not a file.` };
      return { ok: true, resolved, searched, detail: `Resolved stdio executable: ${resolved}.` };
    } catch {
      return { ok: false, resolved: null, searched, detail: missingDetail(trimmed, searched) };
    }
  }
  if (isPath) {
    const resolved = path.resolve(options.cwd ?? process.cwd(), trimmed);
    searched.push(resolved);
    try {
      await stat(resolved);
      return { ok: true, resolved, searched, detail: `Resolved stdio executable: ${resolved}.` };
    } catch {
      return { ok: false, resolved: null, searched, detail: missingDetail(trimmed, searched) };
    }
  }
  const pathValue = options.env?.PATH ?? options.env?.Path ?? process.env.PATH ?? '';
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, trimmed);
    searched.push(candidate);
    try {
      const info = await stat(candidate);
      if (info.isFile())
        return {
          ok: true,
          resolved: candidate,
          searched,
          detail: `Resolved stdio executable: ${candidate}.`,
        };
    } catch {
      continue;
    }
  }
  return { ok: false, resolved: null, searched, detail: missingDetail(trimmed, searched) };
}

function missingDetail(command: string, searched: string[]): string {
  const runtime =
    command === 'npx' || command === 'pi'
      ? ' Bundle the runtime with the service; the service never relies on a hidden global pi/npx.'
      : ' Install the runtime or configure an absolute executable path.';
  return `MCP executable "${command}" was not found (${searched.length} locations searched).${runtime}`;
}

/**
 * What connecting `record` would run or dial, before any env reference is filled in and with the
 * command as configured (`ConnectionManager.launchSpec` swaps in the probed executable). Launch
 * approvals fingerprint exactly these values, which are the ones pi-mcp-adapter's server entry
 * carried, so approvals stored before the migration still match. Secrets resolve separately at
 * connect time; this output carries only what the record holds.
 */
export function toLaunchSpec(record: McpServerConfig): McpLaunchSpec {
  const { stdio, http } = record;
  return {
    ...(stdio
      ? {
          command: stdio.command,
          args: [...stdio.args],
          env: { ...stdio.env },
          inheritEnv: false,
          ...(stdio.cwd ? { cwd: stdio.cwd } : {}),
        }
      : {}),
    ...(http ? { url: http.url, headers: { ...http.headers } } : {}),
  };
}

/**
 * The env or header value that starts with a single `!` (`!!` is the escape for a literal `!`),
 * named as `env NAME` or `header Name`; null when there is none. pi-mcp-adapter ran such a value
 * as a shell command in the service process. Nothing runs it now: the launch gate refuses the
 * launch, and the resolver (mcp/launch-resolve.ts) throws if one ever reaches it.
 */
export function commandValueField(spec: McpLaunchSpec): string | null {
  const fields = [
    ['env', spec.env],
    ['header', spec.headers],
  ] as const;
  for (const [kind, values] of fields)
    for (const [name, value] of Object.entries(values ?? {}))
      if (value.startsWith('!') && !value.startsWith('!!')) return `${kind} ${name}`;
  return null;
}

/** The refusal for a `commandValueField` hit, worded as it always was: a field, never a value. */
export function commandValueRefusal(serverId: string, field: string): McpError {
  return new McpError(
    'forbidden',
    serverId,
    `MCP server ${serverId} sets ${field} to a value starting with "!", which would run as a command; write "!!" for a literal "!".`,
  );
}

/**
 * Connection reuse key: connectionId + configRevision + credential
 * principal + cwd/env scope. Secret VALUES never enter the key, only names.
 * A pooled connection opened for another key is never reused (mcp/pool.ts).
 */
export function reuseKey(record: McpServerConfig): string {
  const scope = record.stdio
    ? `${record.stdio.cwd ?? ''}\0${Object.keys(record.stdio.env).sort().join(',')}`
    : `${record.http?.url ?? ''}\0${Object.keys(record.http?.headers ?? {})
        .sort()
        .join(',')}`;
  const hash = createHash('sha256').update(scope).digest('hex').slice(0, 16);
  return `${record.connectionId}\0${record.revision}\0${record.principal}\0${record.stdio?.cwd ?? ''}\0${hash}`;
}

/**
 * Stable credential identity: a user server's migration v1 server key. A plugin server's qualified
 * id (`<plugin>:<item>`) has no v1 key, and its OAuth sign-in still needs keyring accounts, so it
 * gets `mcp:<serviceId>:~plugin:<hash16>`: `~` is outside the user id alphabet, so no user server's
 * key, nor any account under one, can equal it or start with it.
 */
export function credentialIdentity(
  serviceId: string,
  record: Pick<McpServerConfig, 'serverId' | 'principal'>,
): string {
  if (!record.serverId.includes(':'))
    return mcpServerKey(serviceId, record.serverId, record.principal);
  const hash = createHash('sha256').update(`${record.serverId}\0${record.principal}`);
  return `mcp:${serviceId}:~plugin:${hash.digest('hex').slice(0, 16)}`;
}

/**
 * Connect-time bearer secrets: a non-empty `tokenEnv` value wins over the
 * keyring entry under the record's credential identity. An unreadable keyring
 * answers null, which the connection reports as a missing credential.
 */
export function bearerSecrets(serviceId: string): SecretResolver {
  const keyring = new KeyringBackend(serviceId);
  return {
    bearerToken: async (record) => {
      if (record.http?.auth.type !== 'bearer') return null;
      const envName = record.http.auth.tokenEnv;
      if (envName) {
        const injected = process.env[envName]?.trim();
        if (injected) return injected;
      }
      try {
        const stored = await keyring.get(keyringMcpAccount(credentialIdentity(serviceId, record)));
        return stored ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Physical connection name: isolated records get a per-task alias so two
 * tasks never share one stateful connection; otherwise the server id.
 */
export function physicalName(record: McpServerConfig, taskId?: string): string {
  if (!record.isolateByTask || !taskId) return record.serverId;
  const clean = taskId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'task';
  return `${record.serverId}__t__${clean}`;
}

/** True when a physical name is a task alias of the logical server. */
export function isTaskAlias(record: McpServerConfig, name: string): boolean {
  return name !== record.serverId && name.startsWith(`${record.serverId}__t__`);
}

/** Minimal include/exclude matcher (`*` wildcards). */
export function matchToolPattern(patterns: string[], candidates: string[]): boolean {
  return patterns.some((pattern) => candidates.some((candidate) => glob(pattern, candidate)));
}

function glob(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === value;
  const escaped = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.*')}$`).test(value);
}

/** RFC6570-lite template match: `{var}` spans one path segment. */
export function matchUriTemplate(template: string, uri: string): boolean {
  if (!template.includes('{')) return template === uri;
  const pattern = template.replace(/[.+?^$()|[\]\\]/g, '\\$&').replace(/\{[^/{}]+\}/g, '[^/]+');
  return new RegExp(`^${pattern}$`).test(uri);
}
