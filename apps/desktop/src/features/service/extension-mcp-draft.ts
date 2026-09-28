import type { ExtensionMcpConfig, ExtensionMcpTransport } from './extension-detail-rows';

export type McpTransport = ExtensionMcpTransport;
export type McpAuthKind = 'none' | 'bearer' | 'oauth';

/** What `mcpUpsert` accepts: main replaces the record's transport, command or URL, and auth. */
export type McpUpsertInput = {
  serverId: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  auth: { type: 'none' } | { type: 'bearer'; tokenEnv: string } | { type: 'oauth' };
};

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
};

/** The fields a problem can point at; each maps to one form control. */
export type McpDraftField = 'serverId' | 'command' | 'args' | 'url' | 'tokenEnv';

/** Client-side problems, named after their `extensions.mcpPage.errors.*` copy. */
export type McpDraftProblem =
  | 'serverIdRequired'
  | 'serverIdInvalid'
  | 'serverIdTaken'
  | 'commandRequired'
  | 'argumentsInvalid'
  | 'urlRequired'
  | 'urlInvalid'
  | 'tokenEnvRequired'
  | 'tokenEnvInvalid';

export type McpDraftProblems = Partial<Record<McpDraftField, McpDraftProblem>>;

export const EMPTY_MCP_DRAFT: McpDraft = {
  serverId: '',
  transport: 'stdio',
  command: '',
  argsText: '',
  url: '',
  authKind: 'none',
  tokenEnv: '',
};

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

/**
 * Problems the service would reject or that would leave the server unusable. `takenIds` are the
 * other servers' ids; the add page passes the catalog so an add never silently replaces one.
 */
export function validateDraft(draft: McpDraft, takenIds: readonly string[]): McpDraftProblems {
  const problems: McpDraftProblems = {};
  const serverId = draft.serverId.trim();
  if (!serverId) problems.serverId = 'serverIdRequired';
  else if (!SERVER_ID.test(serverId)) problems.serverId = 'serverIdInvalid';
  else if (takenIds.includes(serverId)) problems.serverId = 'serverIdTaken';
  if (draft.transport === 'stdio') {
    if (!draft.command.trim()) problems.command = 'commandRequired';
    const args = parseArgs(draft.argsText);
    if (args.length > MAX_ARGS || args.some((arg) => arg.length > MAX_ARG_LENGTH))
      problems.args = 'argumentsInvalid';
    return problems;
  }
  const url = draft.url.trim();
  if (!url) problems.url = 'urlRequired';
  else if (!isHttpUrl(url)) problems.url = 'urlInvalid';
  if (draft.authKind === 'bearer') {
    const tokenEnv = draft.tokenEnv.trim();
    if (!tokenEnv) problems.tokenEnv = 'tokenEnvRequired';
    else if (!ENV_NAME.test(tokenEnv)) problems.tokenEnv = 'tokenEnvInvalid';
  }
  return problems;
}

/** The upsert for a valid draft; stdio carries no auth, since only HTTP records keep one. */
export function toUpsertInput(draft: McpDraft): McpUpsertInput {
  const serverId = draft.serverId.trim();
  if (draft.transport === 'stdio') {
    return {
      serverId,
      transport: 'stdio',
      command: draft.command.trim(),
      args: parseArgs(draft.argsText),
      auth: { type: 'none' },
    };
  }
  const auth: McpUpsertInput['auth'] =
    draft.authKind === 'bearer'
      ? { type: 'bearer', tokenEnv: draft.tokenEnv.trim() }
      : { type: draft.authKind };
  return { serverId, transport: draft.transport, url: draft.url.trim(), auth };
}
