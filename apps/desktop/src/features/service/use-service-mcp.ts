import { useState } from 'react';
import { mutationOptions, useMutation, useMutationState } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { McpApprovalRequestResult } from '@ai/agent-contracts';
import { messageOf } from '../../lib/errors';
import { queryClient } from '../../lib/query-client';
import { serviceApi } from './extension-writes';
import { asMcpState, serviceListKeys, useServiceMcpState } from './use-service';
import { readString } from './wire-read';

/**
 * Whether this page can ask for a launch approval: only the macOS shell shows the native
 * confirmation, which the page itself can never stand in for.
 */
export function canConfirmMcpApproval(): boolean {
  return window.desktop !== undefined;
}

/**
 * What to tell the user after the native confirmation for `serverId` answered: nothing when it
 * approved or the user cancelled, otherwise why the server could not be allowed. The Extensions
 * rows and the panel's approval banner share it.
 */
export function mcpApprovalIssue(
  result: McpApprovalRequestResult,
  serverId: string,
  t: TFunction<'settings'>,
): string | null {
  if (result.approved) return null;
  const name = serverId;
  switch (result.reason) {
    case 'cancelled':
      return null;
    case 'changed':
      return t('extensions.mcpApproval.changed', { name });
    case 'unavailable':
      return t('extensions.mcpApproval.unavailable', { name });
    case 'busy':
      return t('extensions.mcpApproval.busy');
    default: {
      const _exhaustive: never = result.reason;
      return _exhaustive;
    }
  }
}

/** One server's connection step; it answers what to note beside the server, if anything. */
interface McpStep {
  serverId: string;
  run: () => Promise<string | null>;
}

const MCP_STEP_KEY = ['mcpStep'] as const;

const mcpStepMutation = mutationOptions({
  mutationKey: MCP_STEP_KEY,
  mutationFn: (step: McpStep) => step.run(),
  // A failed step stays beside its server instead.
  meta: { errorToast: false },
});

const dismissNoticeMutation = mutationOptions({
  mutationKey: ['mcpApprovalNotice'],
  mutationFn: () => serviceApi().mcpDismissApprovalNotice(),
  onSuccess: (result) => queryClient.setQueryData(serviceListKeys.mcp, asMcpState(result)),
});

const reloadMcp = () => queryClient.invalidateQueries({ queryKey: serviceListKeys.mcp });

/**
 * MCP status via the service bridge, with each server's connection steps and launch approval.
 * Approving goes through the host's native confirmation; the page only names the server. A step's
 * result shows in the server's state, so success says nothing more; a failed step, or an approval
 * the confirmation could not give, stays beside that server (`issues`) until its next step. The
 * server whose step runs last is `busyId`.
 */
export function useServiceMcp() {
  const { t } = useTranslation('settings');
  const state = useServiceMcpState();
  const { mutateAsync: runStep } = useMutation(mcpStepMutation, queryClient);
  const { mutate: dismissApprovalNotice } = useMutation(dismissNoticeMutation, queryClient);
  const busyIds = useMutationState(
    {
      filters: { mutationKey: MCP_STEP_KEY, status: 'pending' },
      select: (mutation) => readString(mutation.state.variables, 'serverId'),
    },
    queryClient,
  );
  const [issues, setIssues] = useState<Readonly<Record<string, string>>>({});
  const setIssue = (serverId: string, issue: string | null) => {
    setIssues((current) => {
      if (issue === null) {
        if (!(serverId in current)) return current;
        const rest = { ...current };
        delete rest[serverId];
        return rest;
      }
      return { ...current, [serverId]: issue };
    });
  };
  /** Runs one server's step with its row busy, then reloads the status. */
  const step = (serverId: string, run: () => Promise<string | null>, reload = true) => {
    setIssue(serverId, null);
    return runStep({
      serverId,
      run: () => run().then((issue) => (reload ? reloadMcp().then(() => issue) : issue)),
    }).then(
      (issue) => setIssue(serverId, issue),
      (error: unknown) => setIssue(serverId, messageOf(error)),
    );
  };
  const done = () => null;
  return {
    mcp: state.mcp,
    loading: state.loading,
    busyId: busyIds.at(-1) ?? null,
    issues,
    refresh: reloadMcp,
    setEnabled: state.setEnabled,
    connect: (serverId: string) =>
      step(serverId, () => serviceApi().mcpConnect(serverId).then(done)),
    authStart: (serverId: string) =>
      step(serverId, () => serviceApi().mcpAuthStart(serverId).then(done), false),
    authComplete: (serverId: string, input: string) =>
      step(serverId, () => serviceApi().mcpAuthComplete(serverId, input).then(done)),
    /**
     * Shows the host's native confirmation for one server. An approval shows in the server's
     * state and a cancel changes nothing; only a confirmation that could not decide leaves a note.
     */
    requestApproval: (serverId: string) =>
      step(serverId, () =>
        serviceApi()
          .mcpRequestApproval(serverId)
          .then((result) => mcpApprovalIssue(result, serverId, t)),
      ),
    /**
     * Withdraws a server's approval; the service stops it, so nothing approved keeps running. The
     * server's approval state shows the change.
     */
    withdrawApproval: (serverId: string) =>
      step(
        serverId,
        () =>
          serviceApi()
            .mcpWithdrawApproval(serverId)
            .then((result) => {
              queryClient.setQueryData(serviceListKeys.mcp, asMcpState(result));
              return null;
            }),
        false,
      ),
    dismissApprovalNotice: () => dismissApprovalNotice(),
  };
}
