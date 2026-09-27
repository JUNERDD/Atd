import { getSettings, patchSettings } from '@ai/agent-client';
import {
  DEFAULT_SHORTCUTS,
  parseShortcutBindings,
  type PatchSettingsRequest,
  type SettingsResponse,
} from '@ai/agent-contracts';
import { DEFAULT_PERMISSION_TIER } from '../../electron/agent/permission-schema';
import type { ProviderBridge } from '../../electron/providers/schema';
import { ProviderService } from '../../electron/providers/service';
import {
  isAppLanguage,
  resolveLanguage,
  type SettingsBridge,
  type SettingsSnapshot,
} from '../../electron/settings-contract';
import {
  parseShellAllowlist,
  parseShellAllowlistEntry,
  withShellAllowlistEntry,
} from '../../electron/settings-shell';
import type { WebConnection } from './web-connection';
import type { WebEvents } from './web-events';

/**
 * The settings bridge for the web client. Language, default tier, shell allowlist and shortcuts
 * are the service's shared settings; providers use the same client code as the desktop. Window
 * preferences (pinning, the global panel shortcut) exist only in the desktop app and read as off.
 */
export function webSettings(
  connection: WebConnection,
  events: WebEvents,
  platform: string,
): { bridge: SettingsBridge; providers: ProviderService; ready: Promise<void> } {
  let shared: SettingsResponse | null = null;
  const listeners = new Set<(settings: SettingsSnapshot) => void>();
  const loginListeners = new Set<Parameters<ProviderBridge['onLogin']>[0]>();

  const snapshot = (): SettingsSnapshot => {
    const live = providers.overlay();
    const settings = shared?.settings;
    return {
      connections: live?.connections ?? [],
      defaultConnectionId: live?.defaultConnectionId ?? null,
      language: settings?.language ?? resolveLanguage(navigator.language),
      shortcuts: { ...(settings?.shortcuts ?? DEFAULT_SHORTCUTS) },
      pinned: false,
      shortcutAvailable: false,
      permissionTier: settings?.permissionTier ?? DEFAULT_PERMISSION_TIER,
      shellAllowlist: [...(settings?.shellAllowlist ?? [])],
    };
  };
  const publish = () => {
    const next = snapshot();
    for (const listener of listeners) listener(next);
    return next;
  };
  const providers = new ProviderService(
    publish,
    (state) => {
      for (const listener of loginListeners) listener(state);
    },
    async (url) => void window.open(url, '_blank', 'noopener,noreferrer'),
  );
  providers.attach(connection);

  const reload = async () => {
    shared = await getSettings(connection.options());
    publish();
  };
  const write = async (request: PatchSettingsRequest) => {
    shared = await patchSettings(connection.options(), request);
    return publish();
  };
  connection.onInvalidate((frame) => {
    if (frame.scope === 'settings') void reload().catch(() => undefined);
    if (frame.scope === 'providers') void providers.sync().catch(() => undefined);
  });
  // Frames sent while the stream was down are gone; reload what they would have announced.
  connection.onConnected(() => {
    void reload().catch(() => undefined);
    void providers.sync().catch(() => undefined);
  });
  const ready = Promise.all([reload(), providers.sync()]).then(() => {
    providers.syncCatalogs();
  });

  const settingsUrl = (hash: string) =>
    `${window.location.origin}${window.location.pathname}#${hash}`;
  const bridge: SettingsBridge = {
    open: async () => void window.open(settingsUrl('settings'), 'ai-settings'),
    openCommand: async (commandId) => {
      events.post({ type: 'openCommand', commandId });
      window.open(
        settingsUrl(`settings?commandId=${encodeURIComponent(commandId)}`),
        'ai-settings',
      );
    },
    startCommandSession: async (commandId) => events.post({ type: 'commandSession', commandId }),
    startExtensionSession: async (kind) => events.post({ type: 'extensionSession', kind }),
    close: async () => {
      window.close();
      // A tab the user opened directly cannot close itself; it returns to the panel instead.
      setTimeout(() => {
        if (!window.closed) window.location.replace(settingsUrl(''));
      }, 100);
    },
    get: async () => snapshot(),
    providers: {
      catalog: () => providers.catalog(),
      save: (draft) => providers.save(draft),
      setDefault: (id, revision) => providers.setDefault(id, revision),
      setModel: (reference, revision, level) => providers.setModel(reference, revision, level),
      levels: (reference) => providers.levels(reference),
      contexts: (reference) => providers.contexts(reference),
      setContext: (reference, tier, revision) => providers.setContext(reference, tier, revision),
      disconnect: (id, revision) => providers.disconnect(id, revision),
      refresh: (id) => providers.refresh(id),
      refreshCatalogs: async () => providers.refreshShownCatalogs(),
      verify: (reference) => providers.verify(reference),
      login: (id) => providers.login.start(id),
      answer: (id, promptId, value) => providers.login.answer(id, promptId, value),
      cancel: (id) => providers.login.cancel(id),
      openLink: (id) => providers.login.openLink(id),
      onLogin: (listener) => {
        loginListeners.add(listener);
        return () => loginListeners.delete(listener);
      },
    },
    setLanguage: async (language) => {
      if (!isAppLanguage(language)) throw new TypeError('Unsupported language.');
      return write({ language });
    },
    saveShortcuts: (shortcuts) => write({ shortcuts: parseShortcutBindings(shortcuts, platform) }),
    restoreShortcuts: () => write({ shortcuts: { ...DEFAULT_SHORTCUTS } }),
    setPermissionTier: (tier) => write({ permissionTier: tier }),
    saveShellAllowlist: (entries) => write({ shellAllowlist: parseShellAllowlist(entries) }),
    addShellAllowlistEntry: async (entry) => {
      const current = snapshot().shellAllowlist;
      const next = withShellAllowlistEntry(current, parseShellAllowlistEntry(entry));
      return next === current ? snapshot() : write({ shellAllowlist: next });
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onOpenCommand: (listener) =>
      events.listen((message) => {
        if (message.type === 'openCommand') listener(message.commandId);
      }),
  };
  return { bridge, providers, ready };
}
