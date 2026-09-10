import type { SettingsBridge } from './settings-contract';

export const IPC = {
  hide: 'panel:hide',
  getState: 'panel:get-state',
  setPinned: 'panel:set-pinned',
  chooseFiles: 'panel:choose-files',
} as const;

export interface ContextFile {
  name: string;
  size: number;
  type: string;
}

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
  chooseFiles: () => Promise<ContextFile[]>;
}
