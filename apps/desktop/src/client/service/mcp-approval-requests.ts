import {
  mcpDismissApprovalNotice,
  mcpWithdrawApproval,
  type AgentClientOptions,
} from '@ai/agent-client';
import {
  McpServerIdSchema,
  type McpApprovalRequestResult,
  type McpStatusResponse,
} from '@ai/agent-contracts';
import { Type, type Static } from 'typebox';

/**
 * MCP launch approval actions of the service bridge. The main process validates them here (as part
 * of `ServiceRequestSchema`) before a server id reaches a service URL or a native dialog. Only the
 * server id crosses: the host that confirms reads what would run from the service itself.
 */
export const McpApprovalRequestSchema = Type.Union([
  Type.Object(
    { action: Type.Literal('mcpRequestApproval'), serverId: McpServerIdSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('mcpWithdrawApproval'), serverId: McpServerIdSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('mcpDismissApprovalNotice') },
    { additionalProperties: false },
  ),
]);
export type McpApprovalRequest = Static<typeof McpApprovalRequestSchema>;

/**
 * Asks the host to confirm a server's launch in a native dialog the page cannot forge (an alert
 * the macOS shell shows) and approve it on Allow.
 */
export type RequestMcpApproval = (serverId: string) => Promise<McpApprovalRequestResult>;

export interface ServiceMcpApprovalBridge {
  /** Shows the native confirmation for one server; answers whether it was approved, and why not. */
  mcpRequestApproval: (serverId: string) => Promise<McpApprovalRequestResult>;
  /** Withdraws a server's approval and stops it; answers the new MCP status. */
  mcpWithdrawApproval: (serverId: string) => Promise<McpStatusResponse>;
  /** Dismisses the one-time notice that servers need approving once; answers the new status. */
  mcpDismissApprovalNotice: () => Promise<McpStatusResponse>;
}

export function handleMcpApprovalRequest(
  options: AgentClientOptions,
  request: McpApprovalRequest,
  requestApproval: RequestMcpApproval,
): Promise<unknown> {
  switch (request.action) {
    case 'mcpRequestApproval':
      return requestApproval(request.serverId);
    case 'mcpWithdrawApproval':
      return mcpWithdrawApproval({ options }, request.serverId);
    case 'mcpDismissApprovalNotice':
      return mcpDismissApprovalNotice({ options });
    default: {
      const _exhaustive: never = request;
      throw new Error(`Unsupported MCP approval action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
