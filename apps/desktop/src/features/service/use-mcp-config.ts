import { useEffect, useState } from 'react';
import { messageOf } from '../../lib/errors';
import { asMcpConfig, type ExtensionMcpConfig } from './extension-rows';

export type McpConfigLoad =
  | { serverId: string; config: ExtensionMcpConfig | null }
  | { serverId: string; error: string };

/**
 * Reads the configured record behind one server. It reads again when the server enters or leaves
 * the status list (`listed`), so a server removed elsewhere turns into "missing" instead of
 * keeping a stale record. Null while the first read for this id is in flight.
 */
export function useMcpConfig(serverId: string | null, listed: boolean): McpConfigLoad | null {
  const [loaded, setLoaded] = useState<McpConfigLoad | null>(null);
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
  }, [serverId, listed]);
  return loaded?.serverId === serverId ? loaded : null;
}
