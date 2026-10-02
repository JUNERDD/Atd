import { useMemo } from 'react';
import { mutationOptions, useMutation } from '@tanstack/react-query';
import type {
  PluginConfigRequest,
  PluginDetail,
  PluginDuplicateResponse,
  PluginInstallPreview,
  PluginItemKind,
} from '@atd/agent-contracts';
import { bridgeKeys } from '../../lib/bridge-cache';
import { messageOf } from '../../lib/errors';
import { queryClient } from '../../lib/query-client';
import {
  asDuplicateResult,
  asInstallPreview,
  asPluginDetail,
  type PluginSourceSpec,
} from './plugin-rows';
import { extensionWrite, serviceApi, SWITCH_KEY } from './extension-writes';

/** A step whose failure the page shows in place (install, configure) instead of in a toast. */
export type PluginResult<T> = { ok: true; value: T } | { ok: false; error: string };

const setPluginEnabled = mutationOptions({
  mutationKey: [SWITCH_KEY, 'plugin'],
  mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) =>
    asPluginDetail(await serviceApi().setPluginEnabled(id, enabled)),
});
const setPluginItemEnabled = mutationOptions({
  mutationKey: [SWITCH_KEY, 'pluginItem'],
  mutationFn: async (input: { id: string; kind: PluginItemKind; name: string; enabled: boolean }) =>
    asPluginDetail(await serviceApi().setPluginItemEnabled(input)),
});
const configure = extensionWrite(
  'plugin',
  async ({ id, values }: { id: string; values: PluginConfigRequest['values'] }) =>
    asPluginDetail(await serviceApi().configurePlugin(id, values)),
  { quiet: true },
);
// The copy opens once every list shows it, so the write waits for their reload.
const duplicate = extensionWrite(
  'plugin',
  async (input: { id: string; kind: PluginItemKind; name: string }) =>
    asDuplicateResult(await serviceApi().duplicatePluginItem(input)),
  { reload: bridgeKeys.serviceLists },
);
const preview = extensionWrite(
  'install',
  async ({ source }: { source: PluginSourceSpec }) =>
    asInstallPreview(await serviceApi().previewPlugin(source)),
  { quiet: true },
);
const previewUpdate = extensionWrite(
  'install',
  async ({ id }: { id: string }) => asInstallPreview(await serviceApi().previewPluginUpdate(id)),
  { quiet: true },
);
// Installing and uninstalling change every list; the page moves on without waiting for them.
const install = extensionWrite(
  'install',
  async ({ previewId }: { previewId: string }) =>
    asPluginDetail(await serviceApi().installPlugin(previewId)),
  { reload: bridgeKeys.serviceLists, awaitReload: false, quiet: true },
);
const uninstall = extensionWrite(
  'plugin',
  ({ id }: { id: string }) => serviceApi().uninstallPlugin(id),
  { reload: bridgeKeys.serviceLists, awaitReload: false },
);

const inPlace = <T>(write: Promise<T>): Promise<PluginResult<T>> =>
  write.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error: messageOf(error) }),
  );

/**
 * Plugin writes over the service bridge. Every answer is checked against its contract before a
 * page reads it. Switch writes reject after a toast so the switch can revert; the install and
 * configuration steps answer their error for the page to show inline. The writes that change the
 * lists reload them.
 */
export function usePluginMutations() {
  const pluginSwitch = useMutation(setPluginEnabled, queryClient).mutateAsync;
  const itemSwitch = useMutation(setPluginItemEnabled, queryClient).mutateAsync;
  const saveConfig = useMutation(configure, queryClient).mutateAsync;
  const copy = useMutation(duplicate, queryClient).mutateAsync;
  const previewSource = useMutation(preview, queryClient).mutateAsync;
  const previewNext = useMutation(previewUpdate, queryClient).mutateAsync;
  const installPreview = useMutation(install, queryClient).mutateAsync;
  const remove = useMutation(uninstall, queryClient).mutateAsync;
  // Each `mutateAsync` is stable, so the writes are too: the install page previews from an effect.
  return useMemo(
    () => ({
      setEnabled: (id: string, enabled: boolean): Promise<PluginDetail> =>
        pluginSwitch({ id, enabled }),
      /** `name` is the item's name inside the plugin. */
      setItemEnabled: (input: {
        id: string;
        kind: PluginItemKind;
        name: string;
        enabled: boolean;
      }) => itemSwitch(input),
      configure: (id: string, values: PluginConfigRequest['values']) =>
        inPlace(saveConfig({ id, values })),
      duplicate: (input: {
        id: string;
        kind: PluginItemKind;
        name: string;
      }): Promise<PluginDuplicateResponse | null> => copy(input).catch(() => null),
      preview: (source: PluginSourceSpec): Promise<PluginResult<PluginInstallPreview>> =>
        inPlace(previewSource({ source })),
      previewUpdate: (id: string): Promise<PluginResult<PluginInstallPreview>> =>
        inPlace(previewNext({ id })),
      install: (previewId: string): Promise<PluginResult<PluginDetail>> =>
        inPlace(installPreview({ previewId })),
      uninstall: (id: string): Promise<boolean> =>
        remove({ id }).then(
          () => true,
          () => false,
        ),
    }),
    [
      copy,
      installPreview,
      itemSwitch,
      pluginSwitch,
      previewNext,
      previewSource,
      remove,
      saveConfig,
    ],
  );
}
