import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { McpHttp, McpServerConfig } from '@atd/agent-contracts';
import { MCP_INHERITED_ENV_KEYS } from './constants.js';
import { envReferences, interpolateEnvReferences, unsetEnvReferences } from './env-references.js';
import { McpError } from './errors.js';
import { httpUsesOAuth } from './oauth-client.js';
import { commandValueField, commandValueRefusal } from './servers.js';
import type {
  McpHttpCredential,
  McpHttpLaunch,
  McpLaunchSpec,
  McpStdioLaunch,
  ResolvedLaunch,
} from './types.js';

/**
 * How a launch spec becomes what a connect spawns or dials. The rules are the ones pi-mcp-adapter
 * applied, kept so records written for it mean the same: env references are filled in from the
 * service environment (mcp/env-references.ts), `~` names the home directory in arguments and the
 * working directory, and `!!` is the escape for a literal leading `!`. Nothing here runs a value.
 * A single leading `!` is refused, and error messages name variables and fields, never values.
 */

type Environment = Readonly<Record<string, string | undefined>>;

export interface ResolveOptions {
  /**
   * The authority's cwd: where a stdio server without its own cwd starts, and what a relative
   * cwd resolves against.
   */
  defaultCwd: string;
  /** The variables references read: `process.env` in production. */
  env: Environment;
  /** What the `SecretResolver` gave a bearer record (keyring or `tokenEnv`), or null. */
  bearerToken: string | null;
  /** Selects `MCP_INHERITED_ENV_KEYS`; the running platform unless a test says otherwise. */
  platform?: NodeJS.Platform;
}

/**
 * Resolves `spec`, the launch the user approved, for `record`. The bearer token is used exactly as
 * stored: never filled in, never unescaped, never run.
 */
export async function resolveLaunch(
  record: McpServerConfig,
  spec: McpLaunchSpec,
  options: ResolveOptions,
): Promise<ResolvedLaunch> {
  const { serverId } = record;
  // The launch gate refuses these first; a caller that skipped it still gets nothing run or sent.
  const field = commandValueField(spec);
  if (field) throw commandValueRefusal(serverId, field);
  if (record.stdio) return resolveStdio(serverId, spec, options);
  if (record.http) return resolveHttp(serverId, record.http, spec, options);
  throw new McpError('internal', serverId, `MCP server ${serverId} has nothing to launch.`);
}

/**
 * An HTTP record's URL with its env references filled in. OAuth state is keyed by this URL, so
 * connections and sign-ins must agree on it. A reference to an unset variable refuses the launch,
 * naming the variable; an empty variable is set. A URL that carries a user name or password is
 * refused too, without quoting it.
 */
export function resolveHttpUrl(record: McpServerConfig, env: Environment = process.env): string {
  if (!record.http) {
    throw new McpError(
      'internal',
      record.serverId,
      `MCP server ${record.serverId} is not an HTTP server.`,
    );
  }
  return fillUrl(record.serverId, record.http.url, env);
}

/**
 * `text` with the record's URL as configured wherever it quotes that URL filled in: as written,
 * normalized, or without its fragment. Some library errors quote the URL a connect or sign-in used
 * (pi-mcp's protected-resource check does), and the values its env references hold may be secret.
 */
export function withConfiguredUrl(
  text: string,
  record: McpServerConfig,
  env: Environment = process.env,
): string {
  const configured = record.http?.url;
  if (!configured || envReferences(configured).length === 0) return text;
  const filled = interpolateEnvReferences(configured, env);
  const forms = new Set([filled]);
  try {
    const url = new URL(filled);
    forms.add(url.href);
    url.hash = '';
    forms.add(url.href);
  } catch {
    // Not a URL once filled in: only the text as written can be quoted.
  }
  forms.delete(configured);
  // Longest first, so a form that contains another is replaced whole.
  return [...forms]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .reduce((result, form) => result.split(form).join(configured), text);
}

/**
 * The variables a stdio server inherits from the service besides its own env
 * (`MCP_INHERITED_ENV_KEYS`), skipping unset ones and exported shell functions.
 */
export function inheritedEnv(env: Environment, platform: NodeJS.Platform): Record<string, string> {
  const keys = platform === 'win32' ? MCP_INHERITED_ENV_KEYS.win32 : MCP_INHERITED_ENV_KEYS.posix;
  const inherited: Record<string, string> = {};
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && !value.startsWith('()')) inherited[key] = value;
  }
  return inherited;
}

/** `~` and `~/…` (also `~\…` on Windows) name the home directory, like in a shell. */
export function expandHome(value: string): string {
  if (value === '~') return homedir();
  const windows = process.platform === 'win32';
  if (value.startsWith('~/') || (windows && value.startsWith('~\\'))) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

async function resolveStdio(
  serverId: string,
  spec: McpLaunchSpec,
  options: ResolveOptions,
): Promise<McpStdioLaunch> {
  const { env, defaultCwd, platform = process.platform } = options;
  const command = required(serverId, spec.command, 'executable');
  return {
    kind: 'stdio',
    command,
    args: (spec.args ?? []).map((arg) => expandHome(interpolateEnvReferences(arg, env))),
    cwd: await resolveCwd(serverId, spec.cwd, defaultCwd, env),
    env: { ...inheritedEnv(env, platform), ...fillValues(spec.env ?? {}, env) },
  };
}

/** The configured cwd, filled in and made absolute against `defaultCwd`; it must be a directory. */
async function resolveCwd(
  serverId: string,
  configured: string | undefined,
  defaultCwd: string,
  env: Environment,
): Promise<string> {
  const cwd =
    configured === undefined
      ? defaultCwd
      : path.resolve(defaultCwd, expandHome(interpolateEnvReferences(configured, env)));
  // A path that read the environment is shown as written, so a value never reaches a message.
  const shown = configured !== undefined && envReferences(configured).length > 0 ? configured : cwd;
  const info = await stat(cwd).catch(() => null);
  if (!info) {
    throw new McpError(
      'internal',
      serverId,
      `MCP server "${serverId}" configured cwd does not exist: "${shown}"`,
    );
  }
  if (!info.isDirectory()) {
    throw new McpError(
      'internal',
      serverId,
      `MCP server "${serverId}" configured cwd is not a directory: "${shown}"`,
    );
  }
  return cwd;
}

function resolveHttp(
  serverId: string,
  http: McpHttp,
  spec: McpLaunchSpec,
  options: ResolveOptions,
): McpHttpLaunch {
  const { env } = options;
  const url = fillUrl(serverId, required(serverId, spec.url, 'URL'), env);
  const configured = spec.headers ?? {};
  const headers =
    http.auth.type === 'oauth'
      ? oauthHeaders(serverId, configured, env)
      : fillValues(configured, env);
  // fetch rejects an invalid header with a message that quotes the value; catch it here instead.
  for (const [name, value] of Object.entries(headers)) {
    if (!isHeader(name, value)) {
      throw new McpError(
        'internal',
        serverId,
        `MCP server ${serverId} header "${name}" is not valid once its environment references are filled in.`,
      );
    }
  }
  return {
    kind: http.transport,
    url,
    headers,
    credential: credentialOf(serverId, http, options.bearerToken),
  };
}

function credentialOf(
  serverId: string,
  http: McpHttp,
  bearerToken: string | null,
): McpHttpCredential {
  switch (http.auth.type) {
    case 'none':
      // A server without auth or an Authorization header is offered OAuth on a 401
      // (oauth-client.ts): its connections carry the OAuth auth, which sends no token until one.
      return httpUsesOAuth(http) ? { type: 'oauth' } : { type: 'none' };
    case 'oauth':
      return { type: 'oauth' };
    case 'bearer':
      if (!bearerToken) {
        throw new McpError(
          'auth_required',
          serverId,
          `MCP server ${serverId} is missing its bearer credential.`,
        );
      }
      if (!isHeader('Authorization', `Bearer ${bearerToken}`)) {
        throw new McpError(
          'auth_required',
          serverId,
          `MCP server ${serverId} has a bearer credential that cannot be sent as an HTTP header; store it again.`,
        );
      }
      return { type: 'bearer', token: bearerToken };
  }
}

/**
 * OAuth servers refuse to start a sign-in with a header that reads an unset or empty variable,
 * or that ends up blank: such a header would otherwise be sent silently without its credential.
 */
function oauthHeaders(
  serverId: string,
  configured: Readonly<Record<string, string>>,
  env: Environment,
): Record<string, string> {
  for (const value of Object.values(configured)) {
    const missing =
      unsetEnvReferences(value, env).length > 0 ||
      envReferences(value).some((name) => env[name] === '');
    if (missing) {
      throw new McpError(
        'internal',
        serverId,
        'Missing environment credential in OAuth HTTP headers',
      );
    }
  }
  const filled = fillValues(configured, env);
  if (Object.values(filled).some((value) => !value.trim())) {
    throw new McpError('internal', serverId, 'Failed to resolve OAuth HTTP headers');
  }
  return filled;
}

function fillUrl(serverId: string, template: string, env: Environment): string {
  const unset = unsetEnvReferences(template, env);
  if (unset.length > 0) {
    throw new McpError(
      'internal',
      serverId,
      `Missing environment variable${unset.length === 1 ? '' : 's'} in MCP server URL: ${unset.join(', ')}`,
    );
  }
  const url = interpolateEnvReferences(template, env);
  if (!isHttpUrl(url)) {
    throw new McpError(
      'internal',
      serverId,
      `MCP server ${serverId} URL is invalid after its environment references are filled in.`,
    );
  }
  // fetch never sends such a URL, and the error it fails with quotes the URL, credentials included.
  if (carriesCredentials(url)) {
    throw new McpError(
      'internal',
      serverId,
      `MCP server ${serverId} URL must not carry a user name or password; send credentials in a header or as a bearer token.`,
    );
  }
  return url;
}

function fillValues(
  values: Readonly<Record<string, string>>,
  env: Environment,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, fillValue(value, env)]),
  );
}

/** `!!x` is the escape for a literal leading `!`; a single `!` never gets this far. */
function fillValue(value: string, env: Environment): string {
  return value.startsWith('!!')
    ? `!${interpolateEnvReferences(value.slice(2), env)}`
    : interpolateEnvReferences(value, env);
}

function required(serverId: string, value: string | undefined, what: string): string {
  if (value === undefined) {
    throw new McpError('internal', serverId, `MCP server ${serverId} has no ${what} to launch.`);
  }
  return value;
}

function isHttpUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** A user name or password in `url`, which must be an http(s) URL. */
function carriesCredentials(url: string): boolean {
  const { username, password } = new URL(url);
  return username !== '' || password !== '';
}

function isHeader(name: string, value: string): boolean {
  try {
    new Headers().append(name, value);
    return true;
  } catch {
    return false;
  }
}
