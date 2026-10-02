import type { McpServerExposure } from '@atd/agent-contracts';
import { readFlag, readKeys, readObject, readString, readStrings } from './wire-read';

/**
 * What an item's details page reads beyond its list row: a skill's record and folder listing,
 * and the configured record behind an MCP status row. Wire values arrive as `unknown`.
 */

/** What the skill detail adds to a row: where the skill comes from and its folder's files. */
export interface ExtensionSkillDetail {
  source: string;
  baseDir: string;
  license: string;
  capability: { kind: 'text' | 'script'; tools: string[] };
  disableModelInvocation: boolean;
  /** Paths relative to `baseDir`, `/`-separated; an empty folder ends in `/`. */
  files: string[];
  /** The service cut the listing off at its entry or depth limit. */
  truncated: boolean;
}

export type ExtensionMcpTransport = 'stdio' | 'streamable-http' | 'sse';

/**
 * The configured connection behind an MCP status row. Header and env values never leave the
 * parser: only their names are kept, so a page can say which settings its form cannot carry over.
 */
export interface ExtensionMcpConfig {
  serverId: string;
  transport: ExtensionMcpTransport;
  command: string;
  args: string[];
  /** Names of the stdio process's environment variables. */
  envNames: string[];
  /** The stdio process's working directory; empty when it inherits the service's. */
  cwd: string;
  url: string;
  /** Names of the extra HTTP request headers. */
  headerNames: string[];
  auth: 'none' | 'bearer' | 'oauth' | null;
  /** The bearer token's environment variable; empty for other auth. */
  tokenEnv: string;
  /** OAuth overrides; empty when the defaults apply. */
  oauthScope: string;
  redirectUri: string;
  /** The pre-registered OAuth client; empty (null for the port) when the service registers one. */
  clientId: string;
  clientName: string;
  callbackPort: number | null;
  authServerMetadataUrl: string;
  /** A client secret is stored; its value never reaches the page. */
  clientSecretSet: boolean;
  /** How the server's tools reach the model; `auto` also for a record that predates the field. */
  exposure: McpServerExposure;
  /** Whether the model may list and read the server's resources. */
  exposeResources: boolean;
}

/** The `skillsGet` answer; null when the skill left the catalog or its record is unreadable. */
export function asSkillDetail(value: {
  skill: unknown;
  files: unknown;
  truncated: unknown;
}): ExtensionSkillDetail | null {
  const { skill } = value;
  if (!readString(skill, 'name')) return null;
  const capability = readObject(skill, 'capability');
  return {
    source: readString(skill, 'source'),
    baseDir: readString(skill, 'baseDir'),
    license: readString(skill, 'license'),
    capability: {
      kind: readString(capability, 'kind') === 'script' ? 'script' : 'text',
      tools: readStrings(capability, 'tools'),
    },
    disableModelInvocation: readFlag(skill, 'disableModelInvocation'),
    files: readStrings(value, 'files'),
    truncated: readFlag(value, 'truncated'),
  };
}

function asMcpExposure(value: string): McpServerExposure {
  return value === 'direct' || value === 'deferred' ? value : 'auto';
}

function asPort(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
    ? value
    : null;
}

function asMcpTransport(value: string): ExtensionMcpTransport | null {
  return value === 'stdio' || value === 'streamable-http' || value === 'sse' ? value : null;
}

/** A configured record; one without an id or with a transport outside the contract is dropped. */
export function asMcpConfig(value: unknown): ExtensionMcpConfig | null {
  const serverId = readString(value, 'serverId');
  const transport = asMcpTransport(readString(value, 'transport'));
  if (!serverId || !transport) return null;
  const stdio = readObject(value, 'stdio');
  const http = readObject(value, 'http');
  const authRecord = readObject(http, 'auth');
  const auth = readString(authRecord, 'type');
  return {
    serverId,
    transport,
    command: readString(stdio, 'command'),
    args: readStrings(stdio, 'args'),
    envNames: readKeys(stdio, 'env'),
    cwd: readString(stdio, 'cwd'),
    url: readString(http, 'url'),
    headerNames: readKeys(http, 'headers'),
    auth: auth === 'none' || auth === 'bearer' || auth === 'oauth' ? auth : null,
    tokenEnv: readString(authRecord, 'tokenEnv'),
    oauthScope: readString(authRecord, 'scope'),
    redirectUri: readString(authRecord, 'redirectUri'),
    clientId: readString(authRecord, 'clientId'),
    clientName: readString(authRecord, 'clientName'),
    callbackPort: asPort(readObject(authRecord, 'callbackPort')),
    authServerMetadataUrl: readString(authRecord, 'authServerMetadataUrl'),
    clientSecretSet: readFlag(readObject(authRecord, 'clientSecret'), 'set'),
    exposure: asMcpExposure(readString(value, 'exposure')),
    exposeResources: readFlag(value, 'exposeResources'),
  };
}
