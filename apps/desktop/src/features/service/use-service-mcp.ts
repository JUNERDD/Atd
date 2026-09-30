import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { McpApprovalRequestResult } from '@ai/agent-contracts';
import { showErrorToast } from '../../components/toast-store';
import { messageOf } from '../../lib/errors';
import { asMcpRow, type ExtensionMcpRow } from './extension-rows';

function serviceApi() {
  if (!window.desktop?.service) throw new Error('Open the desktop app to manage the service.');
  return window.desktop.service;
}

/**
 * Whether this page can ask for a launch approval: only the macOS shell shows the native
 * confirmation, which the page itself can never stand in for.
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
 * Approving goes through the host's native confirmation; the page only names the server. A step's
 * result shows in the server's state, so success says nothing more; a failed step, or an approval
 * the confirmation could not give, stays beside that server (`issues`) until its next step.
 */
export function useServiceMcp() {
  const { t } = useTranslation('settings');
  const [mcp, setMcp] = useState<ServiceMcpState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [issues, setIssues] = useState<Readonly<Record<string, string>>>({});
  const setIssue = useCallback((serverId: string, issue: string | null) => {
    setIssues((current) => {
      if (issue === null) {
        if (!(serverId in current)) return current;
        const rest = { ...current };
        delete rest[serverId];
        return rest;
      }
      return { ...current, [serverId]: issue };
    });
  }, []);
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
      setIssue(serverId, null);
      try {
        await run();
        if (reload) await refresh();
      } catch (error) {
        setIssue(serverId, messageOf(error));
      } finally {
        setBusyId(null);
      }
    },
    [refresh, setIssue],
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
  /**
   * Shows the host's native confirmation for one server. An approval shows in the server's state
   * and a cancel changes nothing; only a confirmation that could not decide leaves a note.
   */
  const requestApproval = useCallback(
    (serverId: string) =>
      step(serverId, async () => {
        const result: McpApprovalRequestResult = await serviceApi().mcpRequestApproval(serverId);
        const name = serverId;
        if (result.approved) return;
        switch (result.reason) {
          case 'cancelled':
            return;
          case 'changed':
            setIssue(serverId, t('extensions.mcpApproval.changed', { name }));
            return;
          case 'unavailable':
            setIssue(serverId, t('extensions.mcpApproval.unavailable', { name }));
            return;
          case 'busy':
            setIssue(serverId, t('extensions.mcpApproval.busy'));
            return;
          default: {
            const _exhaustive: never = result.reason;
            return _exhaustive;
          }
        }
      }),
    [setIssue, step, t],
  );
  /**
   * Withdraws a server's approval; the service stops it, so nothing approved keeps running. The
   * server's approval state shows the change.
   */
  const withdrawApproval = useCallback(
    (serverId: string) =>
      step(
        serverId,
        async () => {
          setMcp(asMcpState(await serviceApi().mcpWithdrawApproval(serverId)));
        },
        false,
      ),
    [step],
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
    issues,
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
