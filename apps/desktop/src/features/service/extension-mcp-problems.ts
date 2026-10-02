import { useTranslation } from 'react-i18next';
import type { McpDraftField, McpDraftProblems } from './extension-mcp-draft';

/** Control ids; a problem's message is `<id>-message`, which the control names as its description. */
export const MCP_FIELD_ID: Record<McpDraftField | 'transport' | 'auth' | 'exposure', string> = {
  serverId: 'mcp-server-id',
  transport: 'mcp-transport',
  command: 'mcp-command',
  args: 'mcp-arguments',
  url: 'mcp-url',
  auth: 'mcp-auth',
  tokenEnv: 'mcp-token-env',
  clientId: 'mcp-client-id',
  callbackPort: 'mcp-callback-port',
  metadataUrl: 'mcp-metadata-url',
  clientSecret: 'mcp-client-secret',
  exposure: 'mcp-exposure',
};

/**
 * The page's problems as each control needs them: `problem` is a field's translated message, and
 * `invalid` wires a control to it (invalid state plus the message as its description).
 */
export function useMcpProblems(problems: McpDraftProblems) {
  const { t } = useTranslation('settings');
  const problem = (field: McpDraftField) => {
    const key = problems[field];
    return key ? t(`extensions.mcpPage.errors.${key}`) : undefined;
  };
  const invalid = (field: McpDraftField) =>
    problems[field]
      ? { 'aria-invalid': true, 'aria-describedby': `${MCP_FIELD_ID[field]}-message` }
      : {};
  return { problem, invalid };
}
