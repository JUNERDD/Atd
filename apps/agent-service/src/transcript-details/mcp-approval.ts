import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import { McpServerIdSchema, type McpApprovalDetails } from '@ai/agent-contracts';

/**
 * `configure_mcp`'s details (configure-mcp-tool.ts): present only when the saved server waits for
 * the user's launch approval. An empty object, from a save that needs none, projects to nothing.
 */
const RawMcpApprovalValidator = Compile(
  Type.Object({
    serverId: McpServerIdSchema,
    approval: Type.Union([Type.Literal('required'), Type.Literal('changed')]),
  }),
);

export function projectMcpApprovalDetails(raw: unknown): McpApprovalDetails | undefined {
  if (!RawMcpApprovalValidator.Check(raw)) return undefined;
  return { type: 'mcpApproval', serverId: raw.serverId, approval: raw.approval };
}
