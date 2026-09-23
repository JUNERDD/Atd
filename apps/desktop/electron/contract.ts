import type { AgentBridge } from './agent/bridge';
import type { FileSearchBridge } from './file-search/contract';
import type { SettingsBridge } from './settings-contract';
import type { ServiceBridge } from './service/ipc';

export const IPC = {
  show: 'panel:show',
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
  readonly agent: AgentBridge;
  /** T6 narrow service channel: status/skills/roles/MCP. No token crosses. Optional for test compat. */
  readonly service?: ServiceBridge;
  /**
   * Panel-only system file search: opaque result ids and home-relative folders, never paths.
   * Absent in the web preview and tests, where the file group reads as unavailable.
   */
  readonly files?: FileSearchBridge;
  show: () => Promise<void>;
  hide: () => Promise<void>;
  getState: () => Promise<DesktopState>;
  setPinned: (pinned: boolean) => Promise<boolean>;
  chooseFiles: () => Promise<ContextFile[]>;
}
