import { useCallback, useEffect, useState } from 'react';
import { messageOf } from '../../lib/errors';
import { asMcpConfig, type ExtensionMcpConfig } from './extension-detail-rows';

export type McpConfigLoad =
  | { serverId: string; config: ExtensionMcpConfig | null }
  | { serverId: string; error: string };

/**
 * Reads the configured record behind one server. It reads again when the server enters or leaves
 * the status list (`listed`), so a server removed elsewhere turns into "missing" instead of
 * keeping a stale record. `loaded` is null while the first read for this id is in flight; `retry`
 * reads again after a failure.
 */
export function useMcpConfig(serverId: string | null, listed: boolean) {
  const [loaded, setLoaded] = useState<McpConfigLoad | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const bridge = window.desktop?.service;
    if (!serverId || !bridge) return;
    let active = true;
    bridge.mcpServers().then(
      (result) => {
        if (!active) return;
        const configs = result.servers.flatMap((record) => asMcpConfig(record) ?? []);
        setLoaded({
          serverId,
          config: configs.find((config) => config.serverId === serverId) ?? null,
        });
      },
      (error: unknown) => {
        if (active) setLoaded({ serverId, error: messageOf(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [serverId, listed, attempt]);
  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((value) => value + 1);
  }, []);
  return { loaded: loaded?.serverId === serverId ? loaded : null, retry };
}
