import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { McpLaunchApprovalState } from '@ai/agent-contracts';

// Service MCP connection states (`McpConnectionState`); anything newer shows as sent.
const MCP_STATES = [
  'disabled',
  'disconnected',
  'connecting',
  'auth_required',
  'approval_required',
  'ready',
  'error',
  'closing',
] as const;

function isMcpState(state: string): state is (typeof MCP_STATES)[number] {
  const states: readonly string[] = MCP_STATES;
  return states.includes(state);
}

/** Translates an MCP connection state for display; the settings rows and `@` panel share it. */
export function useMcpStateLabel(): (state: string) => string {
  const { t } = useTranslation('panel');
  return useCallback(
    (state: string) => (isMcpState(state) ? t(`quickPanel.mcpState.${state}`) : state),
    [t],
  );
}

/** A server that is not connected and not connecting can be asked to connect again. */
export function mcpCanConnect(state: string): boolean {
  return state === 'disconnected' || state === 'error';
}

/** The server waits for its user to sign in before it can connect. */
export function mcpNeedsAuth(state: string): boolean {
  return state === 'auth_required';
}

/** Translates a launch approval that asks for attention or can be withdrawn; null otherwise. */
export function useMcpApprovalLabel(): (approval: McpLaunchApprovalState) => string | null {
  const { t } = useTranslation('settings');
  return useCallback(
    (approval: McpLaunchApprovalState) => {
      switch (approval) {
        case 'notRequired':
          return null;
        case 'required':
          return t('extensions.mcpApproval.required');
        case 'changed':
          return t('extensions.mcpApproval.changedState');
        case 'approved':
          return t('extensions.mcpApproval.approved');
        default: {
          const _exhaustive: never = approval;
          return _exhaustive;
        }
      }
    },
    [t],
  );
}

/** The launch waits for the user's approval: never given, withdrawn, or voided by a change. */
export function mcpNeedsApproval(approval: McpLaunchApprovalState): boolean {
  return approval === 'required' || approval === 'changed';
}
