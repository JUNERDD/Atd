import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { McpServerConfigSchema, parse, type McpServerConfig } from '@ai/agent-contracts';
import { KeyringBackend, keyringMcpAccount } from '../credentials/keyring.js';
import { mcpServerKey } from '../credentials/server-keys.js';
import { atomicWrite } from '../config.js';
import type { AdapterMcpConfig, AdapterServerEntry } from './adapter-types.js';
import type { SecretResolver } from './errors.js';

/**
 * Service MCP server records: validation, persistence, stdio/HTTP
 * diagnostics and the adapter config snapshot. Persisted records never
 * carry secrets; bearer tokens resolve at connect time from the keyring
 * (or an explicit env var) into an in-memory adapter entry only.
 */

const ServerFileSchema = Type.Object(
  { version: Type.Literal(1), servers: Type.Array(McpServerConfigSchema) },
  { additionalProperties: false },
);
type ServerFile = Static<typeof ServerFileSchema>;

/** The user catalog as a whole: at most 100 servers. */
const ServerListSchema = Type.Object(
  { servers: Type.Array(McpServerConfigSchema, { maxItems: 100 }) },
  { additionalProperties: false },
);

export function serversFile(dataDir: string): string {
  return path.join(dataDir, 'mcp', 'servers.json');
}

export async function loadServerRecords(dataDir: string): Promise<McpServerConfig[]> {
  try {
    const raw = JSON.parse(await readFile(serversFile(dataDir), 'utf8')) as unknown;
    const file: ServerFile = parse(ServerFileSchema, raw);
    return parseServerConfigs({ servers: file.servers });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw new Error('Saved MCP servers could not be read. The file is preserved.');
  }
}

export async function saveServerRecords(
  dataDir: string,
  servers: McpServerConfig[],
): Promise<void> {
  await atomicWrite(serversFile(dataDir), { version: 1, servers });
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
  options: { cwd?: string; env?: Record<string, string> } = {},
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
 * Builds one adapter entry from a record. Secrets resolve separately at
 * connect time; this output carries only non-secret configuration.
 */
export function toAdapterServerEntry(record: McpServerConfig): AdapterServerEntry {
  const entry: AdapterServerEntry = {
    lifecycle: 'lazy',
    exposeResources: record.exposeResources,
    directTools: false,
    includeTools: [...record.includeTools],
    excludeTools: [...record.excludeTools],
    approveTools: Array.isArray(record.approveTools)
      ? [...record.approveTools]
      : record.approveTools,
    disabled: record.disabled,
    protocolVersion: 'legacy',
  };
  if (record.requestTimeoutMs !== null) entry.requestTimeoutMs = record.requestTimeoutMs;
  if (record.stdio) {
    entry.command = record.stdio.command;
    entry.args = [...record.stdio.args];
    entry.env = { ...record.stdio.env };
    entry.inheritEnv = false;
    if (record.stdio.cwd) entry.cwd = record.stdio.cwd;
  }
  if (record.http) {
    entry.url = record.http.url;
    entry.headers = { ...record.http.headers };
    entry.httpTransport = record.http.transport;
    if (record.http.auth.type === 'none') entry.auth = false;
    else if (record.http.auth.type === 'bearer') entry.auth = 'bearer';
    else {
      entry.auth = 'oauth';
      const oauth: { scope?: string; redirectUri?: string; clientName?: string } = {
        clientName: 'Agent Service',
      };
      if (record.http.auth.scope) oauth.scope = record.http.auth.scope;
      if (record.http.auth.redirectUri) oauth.redirectUri = record.http.auth.redirectUri;
      entry.oauth = oauth;
    }
  }
  return entry;
}

/** Full config snapshot for createMcpAdapter; never a configPath merge. */
export function toAdapterConfig(records: McpServerConfig[]): AdapterMcpConfig {
  const mcpServers: Record<string, AdapterServerEntry> = {};
  for (const record of records) mcpServers[record.serverId] = toAdapterServerEntry(record);
  return {
    mcpServers,
    settings: {
      directTools: false,
      scriptMode: false,
      autoAuth: false,
      sampling: false,
      elicitation: false,
      outputGuard: true,
    },
  };
}

/**
 * Connection reuse key: connectionId + configRevision + credential
 * principal + cwd/env scope. Secret VALUES never enter the key, only names.
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

/** Stable credential identity from migration v1 server keys. */
export function credentialIdentity(serviceId: string, record: McpServerConfig): string {
  return mcpServerKey(serviceId, record.serverId, record.principal);
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

/** Minimal include/exclude matcher (`*` wildcards); adapter stays authoritative. */
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
