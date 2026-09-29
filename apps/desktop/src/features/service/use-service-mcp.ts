import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { McpApprovalRequestResult } from '@ai/agent-contracts';
import { showErrorToast, showToast } from '../../components/toast-store';
import { asMcpRow, type ExtensionMcpRow } from './extension-rows';

function serviceApi() {
  if (!window.desktop?.service) throw new Error('Open the desktop app to manage the service.');
  return window.desktop.service;
}

/**
 * Whether this page can ask for a launch approval: only a desktop host (Electron main or the macOS
 * shell) shows the native confirmation, which the page itself can never stand in for.
 */
export function canConfirmMcpApproval(): boolean {
  return window.desktop !== undefined;
}

/** MCP status rows and the one-time approval notice, as the status route answers them. */
export interface ServiceMcpState {
  servers: ExtensionMcpRow[];
  /** Launch approvals are new: servers configured before them need approving once. */
  approvalNotice: boolean;
}

function asMcpState(result: { servers: unknown[]; approvalNotice: boolean }): ServiceMcpState {
  return {
    servers: result.servers.flatMap((row) => asMcpRow(row) ?? []),
    approvalNotice: result.approvalNotice,
  };
}

/**
 * MCP status via the service bridge, with each server's connection steps and launch approval.
 * Approving goes through the host's native confirmation; the page only names the server and shows
 * what the confirmation answered.
 */
export function useServiceMcp() {
  const { t } = useTranslation('settings');
  const [mcp, setMcp] = useState<ServiceMcpState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!window.desktop?.service) return;
    setLoading(true);
    try {
      setMcp(asMcpState(await window.desktop.service.mcpStatus()));
    } catch (error) {
      showErrorToast(error);
    } finally {
      setLoading(false);
    }
  }, []);
  /** Runs one server's step with its row busy, then reloads the status. */
  const step = useCallback(
    async (serverId: string, run: () => Promise<unknown>, reload = true) => {
      setBusyId(serverId);
      try {
        await run();
        if (reload) await refresh();
      } catch (error) {
        showErrorToast(error);
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );
  const connect = useCallback(
    (serverId: string) => step(serverId, () => serviceApi().mcpConnect(serverId)),
    [step],
  );
  const authStart = useCallback(
    (serverId: string) => step(serverId, () => serviceApi().mcpAuthStart(serverId), false),
    [step],
  );
  const authComplete = useCallback(
    (serverId: string, input: string) =>
      step(serverId, () => serviceApi().mcpAuthComplete(serverId, input)),
    [step],
  );
  /** Shows the host's native confirmation for one server, then says what it answered. */
  const requestApproval = useCallback(
    (serverId: string) =>
      step(serverId, async () => {
        const result: McpApprovalRequestResult = await serviceApi().mcpRequestApproval(serverId);
        const name = serverId;
        if (result.approved) {
          showToast({ kind: 'info', text: t('extensions.mcpApproval.allowed', { name }) });
          return;
        }
        switch (result.reason) {
          case 'cancelled':
            showToast({ kind: 'info', text: t('extensions.mcpApproval.cancelled', { name }) });
            return;
          case 'changed':
            showToast({ kind: 'warning', text: t('extensions.mcpApproval.changed', { name }) });
            return;
          case 'unavailable':
            showToast({ kind: 'warning', text: t('extensions.mcpApproval.unavailable', { name }) });
            return;
          case 'busy':
            showToast({ kind: 'warning', text: t('extensions.mcpApproval.busy') });
            return;
          default: {
            const _exhaustive: never = result.reason;
            return _exhaustive;
          }
        }
      }),
    [step, t],
  );
  /** Withdraws a server's approval; the service stops it, so nothing approved keeps running. */
  const withdrawApproval = useCallback(
    (serverId: string) =>
      step(
        serverId,
        async () => {
          setMcp(asMcpState(await serviceApi().mcpWithdrawApproval(serverId)));
          showToast({
            kind: 'info',
            text: t('extensions.mcpApproval.withdrawn', { name: serverId }),
          });
        },
        false,
      ),
    [step, t],
  );
  const dismissApprovalNotice = useCallback(async () => {
    try {
      setMcp(asMcpState(await serviceApi().mcpDismissApprovalNotice()));
    } catch (error) {
      showErrorToast(error);
    }
  }, []);
  const setEnabled = useCallback((serverId: string, enabled: boolean) => {
    setMcp((current) =>
      current
        ? {
            ...current,
            servers: current.servers.map((row) =>
              row.serverId === serverId ? { ...row, disabled: !enabled } : row,
            ),
          }
        : current,
    );
  }, []);
  return {
    mcp,
    loading,
    busyId,
    refresh,
    setEnabled,
    connect,
    authStart,
    authComplete,
    requestApproval,
    withdrawApproval,
    dismissApprovalNotice,
  };
}
