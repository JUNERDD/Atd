import { useCallback, useEffect, useState } from 'react';
import type { PluginDetail, PluginItem } from '@ai/agent-contracts';
import { messageOf } from '../../lib/errors';
import { asPluginDetail } from './plugin-rows';

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
 * One plugin's detail, read when its page opens and again whenever `epoch` moves (the extensions,
 * commands or memory changed, here or in another client). A reply for another plugin or an older
 * read is dropped. Mutations answer the new detail, which `replace` shows at once; `setItemEnabled`
 * shows a switch change before its save answers; `retry` reads again after a failure.
 */
export function usePluginDetail(id: string, epoch: number) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const bridge = window.desktop?.service;
    if (!bridge) return;
    let active = true;
    bridge.plugin(id).then(
      (value) => {
        if (!active) return;
        try {
          setLoaded({ id, detail: asPluginDetail(value) });
        } catch (error) {
          setLoaded({ id, error: messageOf(error) });
        }
      },
      (error: unknown) => {
        if (active) setLoaded({ id, error: messageOf(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [id, epoch, attempt]);
  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((value) => value + 1);
  }, []);
  const replace = useCallback((detail: PluginDetail) => {
    setLoaded((current) =>
      current?.id === detail.plugin.id ? { id: current.id, detail } : current,
    );
  }, []);
  const setItemEnabled = useCallback(
    (kind: PluginItem['kind'], name: string, itemEnabled: boolean) => {
      setLoaded((current) =>
        current && 'detail' in current
          ? {
              id: current.id,
              detail: {
                ...current.detail,
                items: current.detail.items.map((item) =>
                  item.kind === kind && item.name === name ? { ...item, itemEnabled } : item,
                ),
              },
            }
          : current,
      );
    },
    [],
  );
  return { loaded: loaded?.id === id ? loaded : null, replace, setItemEnabled, retry };
}
