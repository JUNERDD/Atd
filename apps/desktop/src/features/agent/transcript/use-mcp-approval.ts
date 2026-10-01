import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { McpApprovalDetails, McpLaunchApprovalState } from '@ai/agent-contracts';
import { messageOf } from '../../../lib/errors';
import { asMcpRow } from '../../service/extension-rows';
import { mcpApprovalIssue } from '../../service/use-service-mcp';
import type { ViewBlock } from './adapter';

/**
 * The servers `configure_mcp` saved in these steps that waited for launch approval at the call,
 * one per server (the last call wins), in call order.
 */
export function mcpApprovalsIn(steps: readonly ViewBlock[]): McpApprovalDetails[] {
  const byServer = new Map<string, McpApprovalDetails>();
  for (const { source } of steps) {
    const data = source.kind === 'tool' ? source.details.data : undefined;
    if (data?.type !== 'mcpApproval') continue;
    byServer.delete(data.serverId);
    byServer.set(data.serverId, data);
  }
  return [...byServer.values()];
}

/** The server's approval as the status route answers it; null once the server is gone. */
async function currentApproval(serverId: string): Promise<McpLaunchApprovalState | null> {
  const service = window.desktop?.service;
  if (!service) throw new Error('Open the desktop app to manage the service.');
  const { servers } = await service.mcpStatus();
  const rows = servers.flatMap((value) => asMcpRow(value) ?? []);
  return rows.find((row) => row.serverId === serverId)?.approval ?? null;
}

/**
 * One server's current launch approval for the panel's approval banner, reloaded whenever the
 * service announces an Extensions change (an approval from Settings included). `approval` is
 * `undefined` until the first status arrives and `null` once the server is gone; a failed load
 * keeps the last known one. `request` shows the host's native confirmation, the only way to
 * approve; the page names the server and nothing else. A confirmation that could not decide
 * leaves `issue` until the next request.
 */
export function useMcpApproval(serverId: string) {
  const { t } = useTranslation('settings');
  const [approval, setApproval] = useState<McpLaunchApprovalState | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [changes, setChanges] = useState(0);
  // Only the newest status answer applies, so a slow reload never undoes a later one.
  const generation = useRef(0);

  useEffect(
    () =>
      window.desktop?.service?.onChange((event) => {
        if (event.type === 'extensions') setChanges((count) => count + 1);
      }),
    [],
  );
  useEffect(() => {
    if (!window.desktop?.service) return;
    const request = ++generation.current;
    currentApproval(serverId).then(
      (value) => {
        if (request === generation.current) setApproval(value);
      },
      () => undefined,
    );
  }, [serverId, changes]);

  const request = useCallback(async () => {
    const service = window.desktop?.service;
    if (!service) return;
    setPending(true);
    setIssue(null);
    try {
      setIssue(mcpApprovalIssue(await service.mcpRequestApproval(serverId), serverId, t));
      setChanges((count) => count + 1);
    } catch (error) {
      setIssue(messageOf(error));
    } finally {
      setPending(false);
    }
  }, [serverId, t]);

  return { approval, pending, issue, request };
}
