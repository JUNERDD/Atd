import { getSettings, patchSettings } from '@ai/agent-client';
import {
  DEFAULT_SHORTCUTS,
  parseShortcutBindings,
  type PatchSettingsRequest,
  type SettingsResponse,
} from '@ai/agent-contracts';
import { parseExtensionSession } from '../../electron/agent/bridge';
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
import type { NativeBridge } from '../native-bridge/client';
import type { CallResult } from '../native-bridge/contract';
import type { NativeConnection } from './native-connection';
import type { WindowMessages } from './window-messages';

/** The preferences the shell owns, and whether it holds the panel shortcut. */
export type ShellState = CallResult<'app.state'> & { shortcutAvailable: boolean };

/**
 * The settings bridge for the WebView host. Language, default tier, shell allowlist and shortcuts
 * are the service's shared settings; providers use the same client code as the desktop; pinning,
 * the Dock icon and the login item are the shell's, read once and updated by `setShell`.
 */
export function nativeSettings(
  connection: NativeConnection,
  messages: WindowMessages,
  native: NativeBridge,
): {
  bridge: SettingsBridge;
  providers: ProviderService;
  shell: () => ShellState;
  setShell: (patch: Partial<ShellState>) => SettingsSnapshot;
  /** Whether the service's settings loaded; until then the snapshot holds defaults. */
  loaded: () => boolean;
  ready: Promise<void>;
} {
  let shared: SettingsResponse | null = null;
  let shell: ShellState = {
    pinned: false,
    showInDock: false,
    openAtLogin: null,
    shortcutAvailable: false,
  };
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
      ...shell,
      permissionTier: settings?.permissionTier ?? DEFAULT_PERMISSION_TIER,
      shellAllowlist: [...(settings?.shellAllowlist ?? [])],
    };
  };
  const publish = () => {
    const next = snapshot();
    for (const listener of listeners) listener(next);
    return next;
  };
  const openLink = async (url: string) => void (await native.call('link.open', { url }));
  const providers = new ProviderService(
    publish,
    (state) => {
      for (const listener of loginListeners) listener(state);
    },
    openLink,
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
  // The first stream, and every one after a drop: load what the frames would have announced.
  connection.onConnected(() => {
    void reload().catch(() => undefined);
    void providers
      .sync()
      .then(() => providers.syncCatalogs())
      .catch(() => undefined);
  });
  const ready = native.call('app.state', {}).then((state) => {
    shell = { ...shell, ...state };
    publish();
  });

  const bridge: SettingsBridge = {
    open: async () => void (await native.call('settings.open', { commandId: null })),
    openCommand: async (commandId) => {
      // An open settings window switches editors; a new one loads with the command selected.
      messages.post({ type: 'openCommand', commandId });
      await native.call('settings.open', { commandId });
    },
    startCommandSession: async (commandId) => messages.post({ type: 'commandSession', commandId }),
    // Validated here so the caller sees a rejection, as the desktop IPC boundary does.
    startExtensionSession: async (kind, target) =>
      messages.post({ type: 'extensionSession', ...parseExtensionSession(kind, target ?? null) }),
    close: async () => void (await native.call('settings.close', {})),
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
    saveShortcuts: (shortcuts) => write({ shortcuts: parseShortcutBindings(shortcuts, 'darwin') }),
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
      messages.listen((message) => {
        if (message.type === 'openCommand') listener(message.commandId);
      }),
  };
  return {
    bridge,
    providers,
    shell: () => shell,
    loaded: () => shared !== null,
    setShell: (patch) => {
      shell = { ...shell, ...patch };
      return publish();
    },
    ready,
  };
}
