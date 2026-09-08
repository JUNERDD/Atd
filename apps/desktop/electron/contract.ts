export const IPC = {
  hide: 'panel:hide',
  getState: 'panel:get-state',
  setPinned: 'panel:set-pinned',
} as const;

export interface DesktopState {
  pinned: boolean;
  shortcut: string;
  shortcutAvailable: boolean;
  platform: string;
}

export interface DesktopBridge {
  hide: () => Promise<void>;
  getState: () => Promise<DesktopState>;
  setPinned: (pinned: boolean) => Promise<boolean>;
}
