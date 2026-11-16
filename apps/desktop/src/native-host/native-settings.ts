import { getSettings, patchSettings } from '@atd/agent-client';
import {
  DEFAULT_SHORTCUTS,
  parseShortcutBindings,
  type PatchSettingsRequest,
  type SettingsResponse,
} from '@atd/agent-contracts';
import {
  AutomationSessionTargetSchema,
  parseExtensionSession,
} from '../client/agent/session-handoff';
import { parse } from '../client/agent/validation';
import type { ProviderBridge } from '../client/providers/schema';
import { ProviderService } from '../client/providers/service';
import {
  isAppAppearance,
  isAppLanguage,
  isLongScreenshotConfirmAction,
  isScreenshotConfirmAction,
  isViewInitiative,
  type SettingsBridge,
  type SettingsSnapshot,
} from '../client/settings-contract';
import {
  parseShellAllowlist,
  parseShellAllowlistEntry,
  withShellAllowlistEntry,
} from '../client/settings-shell';
import type { NativeBridge } from '../native-bridge/client';
import type { NativeConnection } from './native-connection';
import {
  buildProviderBridge,
  buildSettingsSnapshot,
  initialShellState,
  type ShellState,
} from './native-settings-helpers';
import { settingsItemOf, storeSettingsItem, takeSettingsItem } from './settings-item-link';
import type { WindowMessages } from './window-messages';

export type { ShellState };

/**
 * The settings bridge for the WebView host. Language, default tier, shell allowlist and shortcuts
 * are the service's shared settings; providers use the same client code as the desktop; pinning,
 * the Dock icon and the login item are the shell's, read once and updated by `setShell`.
 */
export function nativeSettings(
  connection: NativeConnection,
  messages: WindowMessages,
  native: NativeBridge,
  surface: 'panel' | 'settings' | 'onboarding' | 'view' = 'panel',
): {
  bridge: SettingsBridge;
  providers: ProviderService;
  shell: () => ShellState;
  setShell: (patch: Partial<ShellState>) => SettingsSnapshot;
  /** Whether the service's settings loaded; until then the snapshot holds defaults. */
  loaded: () => boolean;
  onLoadError: (listener: () => void) => () => void;
  prime: () => Promise<void>;
  ready: Promise<void>;
} {
  let shared: SettingsResponse | null = null;
  let shell: ShellState = initialShellState();
  const listeners = new Set<(settings: SettingsSnapshot) => void>();
  const loadErrorListeners = new Set<() => void>();
  const loginListeners = new Set<Parameters<ProviderBridge['onLogin']>[0]>();

  const snapshot = (): SettingsSnapshot =>
    buildSettingsSnapshot(providers.overlay(), providers.statusesChecked(), shared, shell);
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

  let settingsLoad: Promise<void> | null = null;
  const fetchSettings = () => {
    if (!settingsLoad) {
      settingsLoad = getSettings(connection.options())
        .then((next) => {
          shared = next;
          publish();
        })
        .finally(() => {
          settingsLoad = null;
        });
    }
    return settingsLoad;
  };
  const reload = async () => {
    try {
      await fetchSettings();
    } catch (error) {
      for (const listener of loadErrorListeners) listener();
      throw error;
    }
  };
  // Eager non-panel HTTP prime: silent on pre-stream failure so cold-boot unavailability still
  // waits for the authoritative stream-connected `reload()`.
  const prime = () => fetchSettings().catch(() => undefined);
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
    providers.resetStatusesChecked();
    void reload().catch(() => undefined);
    void providers
      .sync()
      .then(async () => {
        if (surface !== 'panel') return;
        await providers.checkStatuses();
        providers.syncCatalogs();
      })
      .catch(() => undefined);
  });
  const ready = native.call('app.state', {}).then((state) => {
    shell = { ...shell, ...state };
    publish();
  });

  const bridge: SettingsBridge = {
    open: async () => void (await native.call('settings.open', { commandId: null, section: null })),
    openCommand: async (commandId) => {
      // An open settings window switches editors; a new one loads with the command selected.
      messages.post({ type: 'openCommand', commandId });
      await native.call('settings.open', { commandId, section: null });
    },
    openSection: async (section) => {
      messages.post({ type: 'openSection', section });
      await native.call('settings.open', { commandId: null, section });
    },
    openItem: async (item) => {
      // An open settings window takes the message; a new one reads the stored item.
      storeSettingsItem(item);
      messages.post({ type: 'openItem', item });
      await native.call('settings.open', { commandId: null, section: item.section });
    },
    startCommandSession: async (commandId) => messages.post({ type: 'commandSession', commandId }),
    // Validated here so the caller sees a rejection, as the desktop IPC boundary does.
    startAutomationSession: async (automation) =>
      messages.post({
        type: 'automationSession',
        automation: parse(AutomationSessionTargetSchema, automation),
      }),
    startExtensionSession: async (kind, target) =>
      messages.post({ type: 'extensionSession', ...parseExtensionSession(kind, target ?? null) }),
    close: async () => void (await native.call('settings.close', {})),
    get: async () => snapshot(),
    providers: buildProviderBridge(providers, loginListeners),
    setLanguage: async (language) => {
      if (!isAppLanguage(language)) throw new TypeError('Unsupported language.');
      return write({ language });
    },
    setAppearance: async (appearance) => {
      if (appearance !== null && !isAppAppearance(appearance))
        throw new TypeError('Unsupported appearance.');
      return write({ appearance });
    },
    setGlowEffects: (glowEffects) => write({ glowEffects }),
    setResultMarkdown: (resultMarkdown) => write({ resultMarkdown }),
    setPanelBackground: (panelBackground) => write({ panelBackground }),
    saveShortcuts: (shortcuts) => write({ shortcuts: parseShortcutBindings(shortcuts, 'darwin') }),
    setComputerVisionModel: (computerVisionModel) => write({ computerVisionModel }),
    restoreShortcuts: () => write({ shortcuts: { ...DEFAULT_SHORTCUTS } }),
    setPermissionTier: (tier) => write({ permissionTier: tier }),
    saveShellAllowlist: (entries) => write({ shellAllowlist: parseShellAllowlist(entries) }),
    addShellAllowlistEntry: async (entry) => {
      const current = snapshot().shellAllowlist;
      const next = withShellAllowlistEntry(current, parseShellAllowlistEntry(entry));
      return next === current ? snapshot() : write({ shellAllowlist: next });
    },
    saveSelectionToolbar: (value) => write({ selectionToolbar: value }),
    setScreenshotConfirmAction: async (screenshotConfirmAction) => {
      if (!isScreenshotConfirmAction(screenshotConfirmAction)) {
        throw new TypeError('Unsupported screenshot confirm action.');
      }
      return write({ screenshotConfirmAction });
    },
    setScreenshotConfirmInComposer: (screenshotConfirmInComposer) =>
      write({ screenshotConfirmInComposer }),
    setLongScreenshotConfirmAction: async (longScreenshotConfirmAction) => {
      if (!isLongScreenshotConfirmAction(longScreenshotConfirmAction)) {
        throw new TypeError('Unsupported long screenshot confirm action.');
      }
      return write({ longScreenshotConfirmAction });
    },
    saveCommandTyping: (value) => write({ commandTyping: value }),
    saveCommandTypingAnimation: (value) => write({ commandTypingAnimation: value }),
    setViewInitiative: async (viewInitiative) => {
      if (!isViewInitiative(viewInitiative)) throw new TypeError('Unsupported view initiative.');
      return write({ viewInitiative });
    },
    setSummaryTitles: (summaryTitles) => write({ summaryTitles }),
    setNextSteps: (nextSteps) => write({ nextSteps }),
    setNextStepClick: async (nextStepClick) => {
      if (nextStepClick !== 'fill' && nextStepClick !== 'send') {
        throw new TypeError('Unsupported next step click behavior.');
      }
      return write({ nextStepClick });
    },
    requestAccessibility: async () => void (await native.call('accessibility.request', {})),
    requestScreenRecording: async () => void (await native.call('screenRecording.request', {})),
    pickApps: async () => (await native.call('apps.pick', {})).apps,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onOpenCommand: (listener) =>
      messages.listen((message) => {
        if (message.type === 'openCommand') listener(message.commandId);
      }),
    onOpenSection: (listener) =>
      messages.listen((message) => {
        if (message.type === 'openSection') listener(message.section);
      }),
    onOpenItem: (listener) => {
      const pending = takeSettingsItem();
      if (pending) listener(pending);
      return messages.listen((message) => {
        if (message.type !== 'openItem') return;
        takeSettingsItem();
        const item = settingsItemOf(message.item);
        if (item) listener(item);
      });
    },
  };
  return {
    bridge,
    providers,
    shell: () => shell,
    loaded: () => shared !== null,
    onLoadError: (listener) => {
      loadErrorListeners.add(listener);
      return () => loadErrorListeners.delete(listener);
    },
    setShell: (patch) => {
      shell = { ...shell, ...patch };
      return publish();
    },
    prime,
    ready,
  };
}
