export type McpTransport = 'stdio' | 'streamable-http' | 'sse';
export type McpAuthKind = 'none' | 'bearer' | 'oauth';

export type McpUpsertInput = {
  serverId: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  auth: { type: 'none' } | { type: 'bearer'; tokenEnv: string } | { type: 'oauth' };
};

export type McpDraft = {
  serverId: string;
  transport: McpTransport;
  command: string;
  argsText: string;
  url: string;
  authKind: McpAuthKind;
  tokenEnv: string;
};

export const EMPTY_MCP_DRAFT: McpDraft = {
  serverId: '',
  transport: 'stdio',
  command: '',
  argsText: '',
  url: '',
  authKind: 'none',
  tokenEnv: '',
};

export function toUpsertInput(draft: McpDraft): McpUpsertInput {
  const auth =
    draft.authKind === 'bearer'
      ? { type: 'bearer' as const, tokenEnv: draft.tokenEnv.trim() }
      : draft.authKind === 'oauth'
        ? { type: 'oauth' as const }
        : { type: 'none' as const };
  if (draft.transport === 'stdio') {
    return {
      serverId: draft.serverId.trim(),
      transport: 'stdio',
      command: draft.command,
      args: draft.argsText
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean),
      auth,
    };
  }
  return {
    serverId: draft.serverId.trim(),
    transport: draft.transport,
    url: draft.url,
    auth,
  };
}
