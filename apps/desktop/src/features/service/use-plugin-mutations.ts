import { useCallback, useState } from 'react';
import type {
  PluginConfigRequest,
  PluginDetail,
  PluginDuplicateResponse,
  PluginInstallPreview,
  PluginItemKind,
} from '@ai/agent-contracts';
import { showErrorToast } from '../../components/toast-store';
import { messageOf } from '../../lib/errors';
import {
  asDuplicateResult,
  asInstallPreview,
  asPluginDetail,
  type PluginSourceSpec,
} from './plugin-rows';
import type { ExtensionBusyTarget } from './use-extension-mutations';

function serviceApi() {
  if (!window.desktop?.service) throw new Error('Open the desktop app to manage the service.');
  return window.desktop.service;
}

/** A step whose failure the page shows in place (install, configure) instead of in a toast. */
export type PluginResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Plugin writes over the service bridge. Every answer is checked against its contract before a
 * page reads it. Switch writes reject after a toast so the switch can revert; the install and
 * configuration steps answer their error for the page to show inline. Refresh stays with the
 * caller, which also hears the service's `extensions` change event.
 */
export function usePluginMutations() {
  const [busy, setBusy] = useState<ExtensionBusyTarget | null>(null);

  /** Runs one write holding `target`, answering its value or the error message. */
  const hold = useCallback(
    async <T>(target: ExtensionBusyTarget, run: () => Promise<T>): Promise<PluginResult<T>> => {
      setBusy(target);
      try {
        return { ok: true, value: await run() };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const setEnabled = useCallback(async (id: string, enabled: boolean): Promise<PluginDetail> => {
    try {
      return asPluginDetail(await serviceApi().setPluginEnabled(id, enabled));
    } catch (error) {
      showErrorToast(error);
      throw error;
    }
  }, []);

  /** `name` is the item's name inside the plugin. */
  const setItemEnabled = useCallback(
    async (input: { id: string; kind: PluginItemKind; name: string; enabled: boolean }) => {
      try {
        return asPluginDetail(await serviceApi().setPluginItemEnabled(input));
      } catch (error) {
        showErrorToast(error);
        throw error;
      }
    },
    [],
  );

  const configure = useCallback(
    (id: string, values: PluginConfigRequest['values']) =>
      hold({ kind: 'plugin', id }, async () =>
        asPluginDetail(await serviceApi().configurePlugin(id, values)),
      ),
    [hold],
  );

  const duplicate = useCallback(
    async (input: {
      id: string;
      kind: PluginItemKind;
      name: string;
    }): Promise<PluginDuplicateResponse | null> => {
      const result = await hold({ kind: 'plugin', id: input.id }, async () =>
        asDuplicateResult(await serviceApi().duplicatePluginItem(input)),
      );
      if (result.ok) return result.value;
      showErrorToast(result.error);
      return null;
    },
    [hold],
  );

  const preview = useCallback(
    (source: PluginSourceSpec): Promise<PluginResult<PluginInstallPreview>> =>
      hold({ kind: 'install' }, async () =>
        asInstallPreview(await serviceApi().previewPlugin(source)),
      ),
    [hold],
  );

  const previewUpdate = useCallback(
    (id: string): Promise<PluginResult<PluginInstallPreview>> =>
      hold({ kind: 'install' }, async () =>
        asInstallPreview(await serviceApi().previewPluginUpdate(id)),
      ),
    [hold],
  );

  const install = useCallback(
    (previewId: string): Promise<PluginResult<PluginDetail>> =>
      hold({ kind: 'install' }, async () =>
        asPluginDetail(await serviceApi().installPlugin(previewId)),
      ),
    [hold],
  );

  const uninstall = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await hold({ kind: 'plugin', id }, () => serviceApi().uninstallPlugin(id));
      if (!result.ok) showErrorToast(result.error);
      return result.ok;
    },
    [hold],
  );

  return {
    busy,
    setEnabled,
    setItemEnabled,
    configure,
    duplicate,
    preview,
    previewUpdate,
    install,
    uninstall,
  };
}
