import { randomUUID } from 'node:crypto';
import {
  McpServerConfigSchema,
  parse,
  type McpAuthDraft,
  type McpHttpAuth,
  type McpSecretInput,
  type McpServerConfig,
  type McpServerUpsertRequest,
  type McpServerView,
} from '@ai/agent-contracts';
import { McpError } from './errors.js';

/**
 * How clients see and edit the user's MCP servers. The store and the authority keep full records,
 * since connecting needs them; everything that leaves the service goes through `serverView`, and
 * every edit through `upsertRecord`, so env and header values are never read back and a stored
 * secret never follows a server to a new destination.
 */

/** A record with each env and header value replaced by `{ set: true }`. */
export function serverView(record: McpServerConfig): McpServerView {
  return {
    ...record,
    stdio: record.stdio ? { ...record.stdio, env: redacted(record.stdio.env) } : null,
    http: record.http ? { ...record.http, headers: redacted(record.http.headers) } : null,
  };
}

function redacted(values: Record<string, string>): Record<string, { set: true }> {
  return Object.fromEntries(Object.keys(values).map((name) => [name, { set: true as const }]));
}

/** A merged map and the stored names it kept. */
interface SecretMerge {
  values: Record<string, string>;
  kept: string[];
}

/**
 * Merges a sent env or header map with the stored one (see `McpServerUpsertRequestSchema`):
 * omitted keeps all, a sent map replaces, and `{ keep: true }` must name a stored entry.
 */
function mergeSecrets(
  serverId: string,
  field: 'env' | 'headers',
  sent: Record<string, McpSecretInput> | undefined,
  stored: Record<string, string>,
): SecretMerge {
  if (sent === undefined) return { values: { ...stored }, kept: Object.keys(stored) };
  const merged: SecretMerge = { values: {}, kept: [] };
  for (const [name, input] of Object.entries(sent)) {
    if (typeof input === 'string') {
      merged.values[name] = input;
      continue;
    }
    const value = Object.hasOwn(stored, name) ? stored[name] : undefined;
    if (value === undefined)
      throw new McpError(
        'bad_request',
        serverId,
        `MCP server ${serverId} has no stored ${field} entry "${name}" to keep; send a value instead.`,
      );
    merged.values[name] = value;
    merged.kept.push(name);
  }
  return merged;
}

function originOf(serverId: string, url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new McpError('bad_request', serverId, `MCP server ${serverId} has an invalid HTTP url.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new McpError('bad_request', serverId, `MCP server ${serverId} needs an http(s) url.`);
  return parsed.origin;
}

function httpAuth(auth: McpAuthDraft, previous: McpHttpAuth | undefined): McpHttpAuth {
  switch (auth.type) {
    case 'none':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', tokenEnv: auth.tokenEnv };
    case 'oauth':
      // The request has no scope or redirect fields; an OAuth server keeps the ones it had.
      return previous?.type === 'oauth'
        ? { type: 'oauth', scope: previous.scope, redirectUri: previous.redirectUri }
        : { type: 'oauth', scope: null, redirectUri: null };
    default: {
      const _exhaustive: never = auth;
      throw new Error(`Unsupported MCP auth: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function stdioFields(
  serverId: string,
  request: McpServerUpsertRequest,
  previous: McpServerConfig | undefined,
): Pick<McpServerConfig, 'transport' | 'stdio' | 'http'> {
  const command = request.command?.trim() ?? '';
  if (!command)
    throw new McpError('bad_request', serverId, 'A command is required for stdio MCP servers.');
  if (request.headers !== undefined)
    throw new McpError('bad_request', serverId, 'Headers apply only to HTTP MCP servers.');
  const stored = previous?.stdio;
  const env = mergeSecrets(serverId, 'env', request.env, stored?.env ?? {});
  if (stored && env.kept.length && stored.command !== command)
    throw new McpError(
      'bad_request',
      serverId,
      `MCP server ${serverId} cannot keep its environment variables (${env.kept.join(', ')}) for another command; send them again or leave them out.`,
    );
  return {
    transport: 'stdio',
    stdio: { command, args: request.args ?? [], env: env.values, cwd: stored?.cwd ?? null },
    http: null,
  };
}

function httpFields(
  serverId: string,
  transport: 'streamable-http' | 'sse',
  request: McpServerUpsertRequest,
  previous: McpServerConfig | undefined,
): Pick<McpServerConfig, 'transport' | 'stdio' | 'http'> {
  const url = request.url?.trim() ?? '';
  if (!url) throw new McpError('bad_request', serverId, 'A URL is required for HTTP MCP servers.');
  if (request.env !== undefined)
    throw new McpError(
      'bad_request',
      serverId,
      'Environment variables apply only to stdio MCP servers.',
    );
  const origin = originOf(serverId, url);
  const stored = previous?.http;
  const headers = mergeSecrets(serverId, 'headers', request.headers, stored?.headers ?? {});
  const auth = httpAuth(request.auth, stored?.auth);
  if (stored && originOf(serverId, stored.url) !== origin) {
    // The keyring bearer token is keyed by server, not URL, so any bearer auth would carry it.
    const bearer = stored.auth.type === 'bearer' && auth.type === 'bearer';
    if (headers.kept.length || bearer)
      throw new McpError(
        'bad_request',
        serverId,
        `MCP server ${serverId} cannot move its saved ${bearer ? 'bearer credential' : `headers (${headers.kept.join(', ')})`} to another origin; send new values or remove the server and add it again.`,
      );
  }
  return { transport, stdio: null, http: { url, transport, headers: headers.values, auth } };
}

/**
 * The record an upsert stores: the request's connection merged with what `previous` keeps.
 * Switching between stdio and HTTP drops the other kind's fields, which no longer apply.
 */
export function upsertRecord(
  serverId: string,
  request: McpServerUpsertRequest,
  previous: McpServerConfig | undefined,
): McpServerConfig {
  const fields =
    request.transport === 'stdio'
      ? stdioFields(serverId, request, previous)
      : httpFields(serverId, request.transport, request, previous);
  const base: McpServerConfig = previous ?? {
    serverId,
    revision: 1,
    connectionId: randomUUID(),
    transport: fields.transport,
    stdio: null,
    http: null,
    principal: '',
    isolateByTask: false,
    exposeResources: false,
    approveTools: true,
    includeTools: [],
    excludeTools: [],
    requestTimeoutMs: null,
    disabled: false,
  };
  return parse(McpServerConfigSchema, { ...base, ...fields });
}
