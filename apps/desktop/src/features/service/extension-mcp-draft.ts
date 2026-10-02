import type { McpServerExposure } from '@atd/agent-contracts';
import type { McpUpsertInput } from '../../client/service/ipc';
import type { ExtensionMcpConfig, ExtensionMcpTransport } from './extension-detail-rows';
import {
  EMPTY_OAUTH_CLIENT,
  oauthClientFromConfig,
  toOAuthClientDraft,
  validateOAuthClient,
  type McpOAuthClientField,
  type McpOAuthClientFields,
  type McpOAuthClientProblem,
} from './extension-mcp-oauth-draft';

export type McpTransport = ExtensionMcpTransport;
export type McpAuthKind = 'none' | 'bearer' | 'oauth';

/**
 * What `mcpUpsert` accepts: main replaces the record's transport, command or URL, auth (with the
 * OAuth client), tool exposure and resource access.
 */
export type { McpUpsertInput };

/**
 * The MCP page's form state. Arguments are edited one per line, so an argument may contain
 * spaces (a path, a quoted value) without any shell-style quoting.
 */
export type McpDraft = {
  serverId: string;
  transport: McpTransport;
  command: string;
  argsText: string;
  url: string;
  authKind: McpAuthKind;
  tokenEnv: string;
  exposure: McpServerExposure;
  exposeResources: boolean;
} & McpOAuthClientFields;

/** The fields a problem can point at; each maps to one form control. */
export type McpDraftField =
  | 'serverId'
  | 'command'
  | 'args'
  | 'url'
  | 'tokenEnv'
  | McpOAuthClientField;

/** Client-side problems, named after their `extensions.mcpPage.errors.*` copy. */
export type McpDraftProblem =
  | 'serverIdRequired'
  | 'serverIdInvalid'
  | 'serverIdTaken'
  | 'commandRequired'
  | 'argumentsInvalid'
  | 'urlRequired'
  | 'urlInvalid'
  | 'urlKeepsCredentials'
  | 'commandKeepsEnv'
  | 'tokenEnvRequired'
  | 'tokenEnvInvalid'
  | McpOAuthClientProblem;

export type McpDraftProblems = Partial<Record<McpDraftField, McpDraftProblem>>;

export const EMPTY_MCP_DRAFT: McpDraft = {
  serverId: '',
  transport: 'stdio',
  command: '',
  argsText: '',
  url: '',
  authKind: 'none',
  tokenEnv: '',
  exposure: 'auto',
  exposeResources: false,
  ...EMPTY_OAUTH_CLIENT,
};

/** Whether two drafts hold the same values, as an unchanged form does. */
export function sameMcpDraft(a: McpDraft, b: McpDraft): boolean {
  return (Object.keys(a) as (keyof McpDraft)[]).every((key) => a[key] === b[key]);
}

// The limits the desktop IPC schema enforces on `mcpUpsert`, checked here so they show inline.
const SERVER_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_ARGS = 100;
const MAX_ARG_LENGTH = 4096;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/;

/** The form state for an existing record; auth kinds unknown to the form read as none. */
export function draftFromConfig(config: ExtensionMcpConfig): McpDraft {
  return {
    serverId: config.serverId,
    transport: config.transport,
    command: config.command,
    argsText: config.args.join('\n'),
    url: config.url,
    authKind: config.auth ?? 'none',
    tokenEnv: config.tokenEnv,
    exposure: config.exposure,
    exposeResources: config.exposeResources,
    ...oauthClientFromConfig(config),
  };
}

/** One argument per non-blank line, trimmed, so stray indentation never reaches the process. */
function parseArgs(argsText: string): string[] {
  return argsText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === 'http:' || protocol === 'https:';
}

function originOf(url: string): string | null {
  return URL.canParse(url) ? new URL(url).origin : null;
}

/**
 * Problems the service would reject or that would leave the server unusable. `takenIds` are the
 * other servers' ids; the add page passes the catalog so an add never silently replaces one.
 * `saved` is the stored server: saving keeps its env vars and headers, which the service never
 * lets follow another command or URL origin (agent-service `mcp/server-edits.ts`), and neither
 * does a bearer token.
 */
export function validateDraft(
  draft: McpDraft,
  takenIds: readonly string[],
  saved: ExtensionMcpConfig | null = null,
): McpDraftProblems {
  const problems: McpDraftProblems = {};
  const serverId = draft.serverId.trim();
  if (!serverId) problems.serverId = 'serverIdRequired';
  else if (!SERVER_ID.test(serverId)) problems.serverId = 'serverIdInvalid';
  else if (takenIds.includes(serverId)) problems.serverId = 'serverIdTaken';
  if (draft.transport === 'stdio') {
    if (!draft.command.trim()) problems.command = 'commandRequired';
    else if (
      saved?.transport === 'stdio' &&
      saved.envNames.length &&
      draft.command.trim() !== saved.command
    )
      problems.command = 'commandKeepsEnv';
    const args = parseArgs(draft.argsText);
    if (args.length > MAX_ARGS || args.some((arg) => arg.length > MAX_ARG_LENGTH))
      problems.args = 'argumentsInvalid';
    return problems;
  }
  const url = draft.url.trim();
  if (!url) problems.url = 'urlRequired';
  else if (!isHttpUrl(url)) problems.url = 'urlInvalid';
  else if (
    saved &&
    saved.transport !== 'stdio' &&
    (saved.headerNames.length || (saved.auth === 'bearer' && draft.authKind === 'bearer')) &&
    originOf(url) !== originOf(saved.url)
  )
    problems.url = 'urlKeepsCredentials';
  if (draft.authKind === 'bearer') {
    const tokenEnv = draft.tokenEnv.trim();
    if (!tokenEnv) problems.tokenEnv = 'tokenEnvRequired';
    else if (!ENV_NAME.test(tokenEnv)) problems.tokenEnv = 'tokenEnvInvalid';
  }
  if (draft.authKind === 'oauth') {
    const sameOrigin = saved !== null && originOf(url) === originOf(saved.url);
    Object.assign(problems, validateOAuthClient(draft, saved, sameOrigin));
  }
  return problems;
}

/**
 * The upsert for a valid draft; stdio carries no auth, since only HTTP records keep one. OAuth
 * always sends its client, so emptied fields clear the stored ones.
 */
export function toUpsertInput(draft: McpDraft): McpUpsertInput {
  const serverId = draft.serverId.trim();
  const access = { exposure: draft.exposure, exposeResources: draft.exposeResources };
  if (draft.transport === 'stdio') {
    return {
      serverId,
      transport: 'stdio',
      command: draft.command.trim(),
      args: parseArgs(draft.argsText),
      auth: { type: 'none' },
      ...access,
    };
  }
  const auth: McpUpsertInput['auth'] =
    draft.authKind === 'bearer'
      ? { type: 'bearer', tokenEnv: draft.tokenEnv.trim() }
      : draft.authKind === 'oauth'
        ? { type: 'oauth', client: toOAuthClientDraft(draft) }
        : { type: 'none' };
  return { serverId, transport: draft.transport, url: draft.url.trim(), auth, ...access };
}
