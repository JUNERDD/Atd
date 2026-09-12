import { ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { userInfo } from 'node:os';
import type { DesktopState } from './contract';
import { DEFAULT_SHORTCUTS, SETTINGS_IPC, type SettingsSnapshot } from './settings-contract';
import { agentCredential, saveProviderDraft, testProviderDraft } from './settings-provider';
import { PanelShortcut, parseShortcutBindings, shortcutLabel } from './settings-shortcuts';
import { SettingsStore } from './settings-store';
import { SettingsWindow } from './settings-window';
import { isWindowSender } from './window-content';

interface SettingsHost {
  panel: () => BrowserWindow | null;
  togglePanel: () => void;
  applyPinned: (pinned: boolean) => void;
  validateShortcuts?: (shortcuts: SettingsSnapshot['shortcuts']) => void;
}

export class SettingsService {
  private readonly window = new SettingsWindow();
  private readonly shortcut: PanelShortcut;
  private readonly account = { name: userInfo().username, kind: 'local' as const };
  private mutation: Promise<void> = Promise.resolve();

  private constructor(
    private readonly store: SettingsStore,
    private readonly host: SettingsHost,
  ) {
    this.shortcut = new PanelShortcut(host.togglePanel);
    this.shortcut.initialize(store.current.shortcuts.togglePanel);
  }

  static async create(host: SettingsHost): Promise<SettingsService> {
    return new SettingsService(await SettingsStore.load(), host);
  }

  get credential(): string {
    return agentCredential(this.store.current.provider);
  }

  send(channel: string, value: unknown) {
    for (const window of [this.host.panel(), this.window.current]) {
      if (window && !window.isDestroyed()) window.webContents.send(channel, value);
    }
  }

  get pinned(): boolean {
    return this.store.current.pinned;
  }

  get shortcutAvailable(): boolean {
    return this.shortcut.available;
  }

  snapshot(): SettingsSnapshot {
    const { provider, shortcuts, pinned } = this.store.current;
    return {
      provider: {
        id: provider.id,
        baseUrl: provider.baseUrl,
        model: provider.model,
        hasApiKey: Boolean(provider.encryptedApiKey),
      },
      shortcuts: { ...shortcuts },
      account: { ...this.account },
      pinned,
      shortcutAvailable: this.shortcut.available,
    };
  }

  desktopState(): DesktopState {
    return {
      pinned: this.pinned,
      shortcut: shortcutLabel(this.store.current.shortcuts.togglePanel),
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
    for (const window of [this.host.panel(), this.window.current]) {
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(SETTINGS_IPC.changed, snapshot);
      }
    }
    return snapshot;
  }

  open(): Promise<void> {
    return this.window.open();
  }

  setPinned(pinned: boolean): Promise<boolean> {
    return this.serialize(async () => {
      await this.store.commit({ ...this.store.current, pinned });
      this.host.applyPinned(pinned);
      this.broadcast();
      return pinned;
    });
  }

  private saveShortcuts(value: unknown): Promise<SettingsSnapshot> {
    return this.serialize(async () => {
      const shortcuts = parseShortcutBindings(value);
      this.host.validateShortcuts?.(shortcuts);
      await this.shortcut.replace(shortcuts.togglePanel, () =>
        this.store.commit({ ...this.store.current, shortcuts }),
      );
      return this.broadcast();
    });
  }

  installIpc() {
    ipcMain.handle(SETTINGS_IPC.open, (event) => {
      this.assertSender(event);
      return this.open();
    });
    ipcMain.handle(SETTINGS_IPC.close, (event) => {
      this.assertSender(event, true);
      this.window.close();
    });
    ipcMain.handle(SETTINGS_IPC.get, (event) => {
      this.assertSender(event);
      return this.snapshot();
    });
    ipcMain.handle(SETTINGS_IPC.saveProvider, (event, value: unknown) => {
      this.assertSender(event, true);
      return this.serialize(async () => {
        const provider = saveProviderDraft(value, this.store.current.provider);
        await this.store.commit({ ...this.store.current, provider });
        return this.broadcast();
      });
    });
    ipcMain.handle(SETTINGS_IPC.testProvider, (event, value: unknown) => {
      this.assertSender(event, true);
      return testProviderDraft(value, this.store.current.provider);
    });
    ipcMain.handle(SETTINGS_IPC.saveShortcuts, (event, value: unknown) => {
      this.assertSender(event, true);
      return this.saveShortcuts(value);
    });
    ipcMain.handle(SETTINGS_IPC.restoreShortcuts, (event) => {
      this.assertSender(event, true);
      return this.saveShortcuts(DEFAULT_SHORTCUTS);
    });
  }
}
