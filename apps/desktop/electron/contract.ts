import type { SettingsBridge } from './settings-contract';

export const IPC = {
  hide: 'panel:hide',
  getState: 'panel:get-state',
  setPinned: 'panel:set-pinned',
} as const;

export interface DesktopState {
  pinned: boolean;
  shortcut: string;
  shortcutAvailable: boolean;
}

export interface DesktopBridge {
  readonly platform: string;
  readonly settings: SettingsBridge;
  hide: () => Promise<void>;
  getState: () => Promise<DesktopState>;
  setPinned: (pinned: boolean) => Promise<boolean>;
}
