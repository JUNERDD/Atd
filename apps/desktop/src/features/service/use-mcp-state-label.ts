import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// Service MCP connection states (`McpConnectionState`); anything newer shows as sent.
const MCP_STATES = [
  'disabled',
  'disconnected',
  'connecting',
  'auth_required',
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
