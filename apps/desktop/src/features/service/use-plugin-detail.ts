import { useQuery } from '@tanstack/react-query';
import type { PluginDetail, PluginItem } from '@atd/agent-contracts';
import { wireServiceBridge } from '../../lib/bridge-cache';
import { messageOf } from '../../lib/errors';
import { queryClient } from '../../lib/query-client';
import { asPluginDetail } from './plugin-rows';
import { serviceListKeys } from './use-service';

/**
 * One item of a plugin as the service lists it, for a caller that holds only the catalog name (a
 * search hit, an item page): the plugin routes address items by their name inside the plugin,
 * which only the plugin's detail states.
 */
export async function findPluginItem(
  pluginId: string,
  kind: PluginItem['kind'],
  name: string,
): Promise<PluginItem> {
  const bridge = window.desktop?.service;
  if (!bridge) throw new Error('Open the desktop app to manage the service.');
  const detail = asPluginDetail(await bridge.plugin(pluginId));
  const item = detail.items.find((entry) => entry.kind === kind && entry.name === name);
  if (!item) throw new Error(`"${name}" is no longer part of this plugin.`);
  return item;
}

type Loaded = { id: string; detail: PluginDetail } | { id: string; error: string };

/**
 * One plugin's detail, read when its page opens and again with every reload of the plugin list
 * (the extensions, commands or memory changed, here or in another client). A detail stays shown
 * when a later read fails. Mutations answer the new detail, which `replace` shows at once;
 * `setItemEnabled` shows a switch change before its save answers; `retry` reads again after a
 * failure.
 */
export function usePluginDetail(id: string) {
  const bridge = window.desktop?.service;
  const { data, error, refetch } = useQuery(
    {
      queryKey: serviceListKeys.plugin(id),
      queryFn: async () => {
        if (!bridge) throw new Error('Open the desktop app to manage the service.');
        wireServiceBridge(bridge);
        return asPluginDetail(await bridge.plugin(id));
      },
      enabled: Boolean(bridge),
      // The page shows a failed read in place, with its retry.
      meta: { errorToast: false },
    },
    queryClient,
  );
  const loaded: Loaded | null = data
    ? { id, detail: data }
    : error
      ? { id, error: messageOf(error) }
      : null;
  return {
    loaded,
    replace: (detail: PluginDetail) =>
      queryClient.setQueryData<PluginDetail>(serviceListKeys.plugin(detail.plugin.id), detail),
    setItemEnabled: (kind: PluginItem['kind'], name: string, itemEnabled: boolean) =>
      queryClient.setQueryData<PluginDetail>(serviceListKeys.plugin(id), (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.kind === kind && item.name === name ? { ...item, itemEnabled } : item,
              ),
            }
          : current,
      ),
    retry: () => void refetch(),
  };
}
