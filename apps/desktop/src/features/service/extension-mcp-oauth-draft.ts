import type { McpOAuthClientDraft } from '@ai/agent-contracts';
import type { ExtensionMcpConfig } from './extension-detail-rows';

/**
 * The pre-registered OAuth client part of the MCP form (`McpOAuthClientDraft` in
 * agent-contracts). Every field is optional: left empty, the service registers a client itself.
 * The port is edited as text so a partial entry can show its own message.
 */
export type McpOAuthClientFields = {
  clientId: string;
  clientName: string;
  callbackPort: string;
  metadataUrl: string;
  /**
   * The secret to store: null keeps the stored one (only a record with a secret starts there),
   * text replaces it, and empty text stores none.
   */
  clientSecret: string | null;
};

export type McpOAuthClientField = 'clientId' | 'callbackPort' | 'metadataUrl' | 'clientSecret';

/** Problems the service would refuse, named after their `extensions.mcpPage.errors.*` copy. */
export type McpOAuthClientProblem =
  | 'clientIdRequiredForSecret'
  | 'callbackPortInvalid'
  | 'metadataUrlInvalid'
  | 'metadataUrlInsecure'
  | 'clientSecretNotKept';

export const EMPTY_OAUTH_CLIENT: McpOAuthClientFields = {
  clientId: '',
  clientName: '',
  callbackPort: '',
  metadataUrl: '',
  clientSecret: '',
};

/** The stored client as form fields; a stored secret starts as kept. */
export function oauthClientFromConfig(config: ExtensionMcpConfig): McpOAuthClientFields {
  return {
    clientId: config.clientId,
    clientName: config.clientName,
    callbackPort: config.callbackPort === null ? '' : String(config.callbackPort),
    metadataUrl: config.authServerMetadataUrl,
    clientSecret: config.clientSecretSet ? null : '',
  };
}

// The hosts agent-service accepts plain http on (`mcp/oauth-client.ts`); WHATWG keeps IPv6
// brackets in `hostname`.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PORT = /^\d{1,5}$/;

function metadataUrlProblem(value: string): McpOAuthClientProblem | null {
  if (!URL.canParse(value)) return 'metadataUrlInvalid';
  const url = new URL(value);
  if (url.username || url.password) return 'metadataUrlInvalid';
  if (url.protocol === 'https:') return null;
  if (url.protocol !== 'http:') return 'metadataUrlInvalid';
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ? null : 'metadataUrlInsecure';
}

/**
 * What the service would refuse in the client (agent-service `mcp/server-edits.ts`): a port
 * outside 1-65535, metadata that is not https (http only on a loopback host), a secret without a
 * client id, and a kept secret whose client id, metadata URL or site (`sameOrigin`) changed, since
 * a stored secret only ever goes to the client it was saved for.
 */
export function validateOAuthClient(
  fields: McpOAuthClientFields,
  saved: ExtensionMcpConfig | null,
  sameOrigin: boolean,
): Partial<Record<McpOAuthClientField, McpOAuthClientProblem>> {
  const problems: Partial<Record<McpOAuthClientField, McpOAuthClientProblem>> = {};
  const clientId = fields.clientId.trim();
  const metadataUrl = fields.metadataUrl.trim();
  const port = fields.callbackPort.trim();
  if (port && (!PORT.test(port) || Number(port) < 1 || Number(port) > 65535))
    problems.callbackPort = 'callbackPortInvalid';
  const metadataProblem = metadataUrl ? metadataUrlProblem(metadataUrl) : null;
  if (metadataProblem) problems.metadataUrl = metadataProblem;
  const keeps = fields.clientSecret === null && Boolean(saved?.clientSecretSet);
  const hasSecret = keeps || Boolean(fields.clientSecret?.trim());
  if (hasSecret && !clientId) problems.clientId = 'clientIdRequiredForSecret';
  if (
    keeps &&
    saved &&
    (clientId !== saved.clientId || metadataUrl !== saved.authServerMetadataUrl || !sameOrigin)
  )
    problems.clientSecret = 'clientSecretNotKept';
  return problems;
}

/** The client of an OAuth upsert: the whole new client, so an emptied field clears it. */
export function toOAuthClientDraft(fields: McpOAuthClientFields): McpOAuthClientDraft {
  const clientId = fields.clientId.trim();
  const clientName = fields.clientName.trim();
  const port = fields.callbackPort.trim();
  const metadataUrl = fields.metadataUrl.trim();
  const secret = fields.clientSecret?.trim() ?? null;
  return {
    ...(clientId ? { clientId } : {}),
    ...(clientName ? { clientName } : {}),
    ...(port ? { callbackPort: Number(port) } : {}),
    ...(metadataUrl ? { authServerMetadataUrl: metadataUrl } : {}),
    ...(secret === null ? { clientSecret: { keep: true as const } } : {}),
    ...(secret ? { clientSecret: secret } : {}),
  };
}
