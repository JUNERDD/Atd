import { ipcMain, shell } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { DesktopState } from './contract';
import { isAppLanguage, SETTINGS_IPC, type SettingsSnapshot } from './settings-contract';
import { PermissionTierSchema } from './agent/permission-schema';
import { parse } from './agent/validation';
import { installProviderIpc } from './providers/ipc';
import { PROVIDER_IPC } from './providers/ipc-channels';
import { ProviderService } from './providers/service';
import { publicConnection } from './providers/configuration';
import { DEFAULT_SHORTCUTS, parseShortcutBindings, type UserSettings } from '@ai/agent-contracts';
import type { ServiceConnection } from './service/connection';
import {
  parseShellAllowlist,
  parseShellAllowlistEntry,
  withShellAllowlistEntry,
} from './settings-shell';
import { ServiceSettingsSync } from './settings-sync';
import { shortcutLabel } from './accelerators';
import { PanelShortcut } from './settings-shortcuts';
import { SettingsStore } from './settings-store';
import { SettingsWindow } from './settings-window';
import { isWindowSender, sendToPage } from './window-content';
import type { PanelSize } from './window-position';

interface SettingsHost {
  panel: () => BrowserWindow | null;
  togglePanel: () => void;
  applyPinned: (pinned: boolean) => void;
  validateShortcuts?: (shortcuts: SettingsSnapshot['shortcuts']) => void;
}

export class SettingsService {
  private readonly window = new SettingsWindow();
  private readonly shortcut: PanelShortcut;
  readonly providers: ProviderService;
  /** Keeps language, default tier, shell allowlist and shortcuts equal to the service's copy. */
  private readonly shared: ServiceSettingsSync;
  private mutation: Promise<void> = Promise.resolve();

  private constructor(
    private readonly store: SettingsStore,
    private readonly host: SettingsHost,
  ) {
    this.shortcut = new PanelShortcut(host.togglePanel);
    this.shortcut.initialize(store.current.shortcuts.togglePanel);
    this.providers = new ProviderService(
      () => this.broadcast(),
      (state) => this.send(PROVIDER_IPC.loginEvent, state),
      (url) => shell.openExternal(url),
    );
    this.shared = new ServiceSettingsSync(
      () => {
        const { language, permissionTier, shellAllowlist, shortcuts } = this.store.current;
        return { language, permissionTier, shellAllowlist, shortcuts };
      },
      (settings) => this.adoptShared(settings),
    );
  }

  /** Connects the service-backed parts: providers and the shared settings. */
  attach(connection: ServiceConnection) {
    this.providers.attach(connection);
    this.shared.attach(connection);
    connection.onInvalidate((frame) => {
      if (frame.scope === 'providers') void this.providers.sync().catch(() => undefined);
    });
  }

  /**
   * Applies the service's shared settings to the local cache. A service without a language
   * (only the web client wrote settings) keeps the one resolved here; shortcuts another client
   * saved are applied even when the OS refuses the panel shortcut, which then reads unavailable.
   */
  private adoptShared(settings: UserSettings): Promise<void> {
    return this.serialize(async () => {
      const current = this.store.current;
      let shortcuts = current.shortcuts;
      try {
        shortcuts = parseShortcutBindings(
          settings.shortcuts ?? DEFAULT_SHORTCUTS,
          process.platform,
        );
      } catch {
        // Bindings this platform cannot parse keep the local ones.
      }
      this.shortcut.adopt(shortcuts.togglePanel);
      await this.store.change((data) => {
        data.language = settings.language ?? data.language;
        data.permissionTier = settings.permissionTier;
        data.shellAllowlist = [...settings.shellAllowlist];
        data.shortcuts = shortcuts;
      });
      this.broadcast();
    });
  }

  static async create(host: SettingsHost): Promise<SettingsService> {
    return new SettingsService(await SettingsStore.load(), host);
  }

  send(channel: string, value: unknown) {
    for (const window of [this.host.panel(), this.window.current])
      sendToPage(window, channel, value);
  }

  /** Sends what only the panel renders, sparing the settings window the copy. */
  sendToPanel(channel: string, value: unknown) {
    sendToPage(this.host.panel(), channel, value);
  }

  get pinned(): boolean {
    return this.store.current.pinned;
  }

  get panelSize(): PanelSize {
    return this.store.current.panelSize;
  }

  get shortcutAvailable(): boolean {
    return this.shortcut.available;
  }

  snapshot(): SettingsSnapshot {
    const {
      connections,
      defaultConnectionId,
      language,
      shortcuts,
      pinned,
      permissionTier,
      shellAllowlist,
    } = this.store.current;
    const live = this.providers.overlay();
    return {
      connections: live?.connections ?? connections.map(publicConnection),
      defaultConnectionId: live?.defaultConnectionId ?? defaultConnectionId,
      language,
      shortcuts: { ...shortcuts },
      pinned,
      shortcutAvailable: this.shortcut.available,
      permissionTier,
      shellAllowlist: [...shellAllowlist],
    };
  }

  desktopState(): DesktopState {
    return {
      pinned: this.pinned,
      shortcut: shortcutLabel(this.store.current.shortcuts.togglePanel, process.platform),
      shortcutAvailable: this.shortcutAvailable,
    };
  }

  assertSender(event: IpcMainInvokeEvent, settingsOnly = false) {
    if (
      !isWindowSender(event, this.window.current) &&
      (settingsOnly || !isWindowSender(event, this.host.panel()))
    ) {
      throw new Error('Untrusted desktop request');
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutation.then(operation);
    this.mutation = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private broadcast(): SettingsSnapshot {
    const snapshot = this.snapshot();
    this.send(SETTINGS_IPC.changed, snapshot);
    return snapshot;
  }

  open(): Promise<void> {
    return this.window.open();
  }

  /**
   * Opens the settings window at the editor for one command. The panel owns the command id it
   * shows, so the id is validated here and the settings renderer resolves it against the agent
   * snapshot; an unknown id lands on the command list instead of failing the open.
   */
  async openCommand(commandId: unknown): Promise<void> {
    if (typeof commandId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(commandId)) {
      throw new TypeError('Unknown command.');
    }
    const alreadyOpen = this.window.current !== null;
    await this.window.open(`settings?commandId=${encodeURIComponent(commandId)}`);
    if (alreadyOpen) {
      this.window.current?.webContents.send(SETTINGS_IPC.openCommand, commandId);
    }
  }

  setPinned(pinned: boolean): Promise<boolean> {
    return this.serialize(async () => {
      await this.store.change((data) => {
        data.pinned = pinned;
      });
      this.host.applyPinned(pinned);
      this.broadcast();
      return pinned;
    });
  }

  setPanelSize(size: PanelSize): Promise<void> {
    const stored = this.store.current.panelSize;
    if (stored.width === size.width && stored.height === size.height) return Promise.resolve();
    return this.serialize(async () => {
      await this.store.change((data) => {
        data.panelSize = { width: size.width, height: size.height };
      });
    });
  }

  private saveLanguage(value: unknown): Promise<SettingsSnapshot> {
    if (!isAppLanguage(value)) throw new TypeError('Unsupported language.');
    return this.serialize(async () => {
      await this.store.change((data) => {
        data.language = value;
      });
      this.shared.changed(['language']);
      return this.broadcast();
    });
  }

  setPermissionTier(tier: unknown): Promise<SettingsSnapshot> {
    const permissionTier = parse(PermissionTierSchema, tier);
    return this.serialize(async () => {
      await this.store.change((data) => {
        data.permissionTier = permissionTier;
      });
      this.shared.changed(['permissionTier']);
      return this.broadcast();
    });
  }

  /**
   * Runs one shell allowlist update in the settings queue, then broadcasts it and sends it to the
   * service. `update` returning the current array means nothing changed: no write, no push.
   */
  private updateShellAllowlist(update: (current: string[]) => string[]): Promise<SettingsSnapshot> {
    return this.serialize(async () => {
      const current = this.store.current.shellAllowlist;
      const next = update(current);
      if (next === current) return this.snapshot();
      await this.store.change((data) => {
        data.shellAllowlist = next;
      });
      this.shared.changed(['shellAllowlist']);
      return this.broadcast();
    });
  }

  private saveShortcuts(value: unknown): Promise<SettingsSnapshot> {
    return this.serialize(async () => {
      const shortcuts = parseShortcutBindings(value, process.platform);
      this.host.validateShortcuts?.(shortcuts);
      await this.shortcut.replace(shortcuts.togglePanel, () =>
        this.store.change((data) => {
          data.shortcuts = shortcuts;
        }),
      );
      this.shared.changed(['shortcuts']);
      return this.broadcast();
    });
  }

  installIpc() {
    installProviderIpc(this.providers, (event, settingsOnly) =>
      this.assertSender(event, settingsOnly),
    );
    ipcMain.handle(SETTINGS_IPC.open, (event) => {
      this.assertSender(event);
      return this.open();
    });
    ipcMain.handle(SETTINGS_IPC.openCommand, (event, commandId: unknown) => {
      this.assertSender(event);
      return this.openCommand(commandId);
    });
    ipcMain.handle(SETTINGS_IPC.close, (event) => {
      this.assertSender(event, true);
      this.window.close();
    });
    ipcMain.handle(SETTINGS_IPC.get, (event) => {
      this.assertSender(event);
      return this.snapshot();
    });
    ipcMain.handle(SETTINGS_IPC.saveLanguage, (event, value: unknown) => {
      this.assertSender(event, true);
      return this.saveLanguage(value);
    });
    ipcMain.handle(SETTINGS_IPC.savePermissionTier, (event, value: unknown) => {
      // The panel home view edits the default tier a new task freezes at creation.
      this.assertSender(event);
      return this.setPermissionTier(value);
    });
    ipcMain.handle(SETTINGS_IPC.saveShortcuts, (event, value: unknown) => {
      this.assertSender(event, true);
      return this.saveShortcuts(value);
    });
    ipcMain.handle(SETTINGS_IPC.saveShellAllowlist, (event, value: unknown) => {
      this.assertSender(event, true);
      const entries = parseShellAllowlist(value);
      return this.updateShellAllowlist(() => entries);
    });
    ipcMain.handle(SETTINGS_IPC.addShellAllowlistEntry, (event, value: unknown) => {
      // The panel's bash confirm adds the suggested entry; the settings page adds typed ones.
      this.assertSender(event);
      const entry = parseShellAllowlistEntry(value);
      return this.updateShellAllowlist((current) => withShellAllowlistEntry(current, entry));
    });
    ipcMain.handle(SETTINGS_IPC.restoreShortcuts, (event) => {
      this.assertSender(event, true);
      return this.saveShortcuts(DEFAULT_SHORTCUTS);
    });
  }
}
