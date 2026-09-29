import type { FileSearchQuery, FileSearchReply } from '@ai/agent-contracts';
import type { AgentBridge } from './agent/bridge';
import type { FileRef } from './agent/task-schema';
import type { SettingsBridge } from './settings-contract';
import type { ServiceBridge } from './service/ipc';

export const IPC = {
  show: 'panel:show',
  hide: 'panel:hide',
  getState: 'panel:get-state',
  setPinned: 'panel:set-pinned',
  setShowInDock: 'app:set-show-in-dock',
  setOpenAtLogin: 'app:set-open-at-login',
  chooseFiles: 'panel:choose-files',
  /** Panel-only, kept apart from `agent:request`, which also trusts the settings window. */
  searchFiles: 'files:search',
  attachFiles: 'files:attach',
  /** Main → renderer only: Edit → Undo/Redo clicked in the application menu for this window. */
  editCommand: 'app:edit-command',
} as const;

/** Application menu edits the renderer runs itself (see `app-menu.ts`). */
export type EditCommand = 'undo' | 'redo';

export interface ContextFile {
  name: string;
  size: number;
  type: string;
}

/** The panel's `@` file search; main forwards it to the service's file routes. */
export interface FileSearchBridge {
  /** An empty query returns recent files only. */
  search(request: FileSearchQuery): Promise<FileSearchReply>;
  /** Creates resources from the files behind the ids; rejects with English messages. */
  attach(resultIds: string[]): Promise<FileRef[]>;
}

export interface DesktopState {
  pinned: boolean;
  shortcut: string;
  shortcutAvailable: boolean;
}

export interface DesktopBridge {
  /**
   * `electron` is the Electron app; `native` is the macOS shell hosting the renderer in a
   * WKWebView (`src/native-host`). Both own native window surfaces; only Electron styles them with
   * `-webkit-app-region`, while the shell takes the drag regions the page publishes.
   */
  readonly runtime: 'electron' | 'native';
  /** The OS as a Node platform name. */
  readonly platform: string;
  readonly settings: SettingsBridge;
  readonly agent: AgentBridge;
  /** T6 narrow service channel: status/skills/roles/MCP. No token crosses. Optional for test compat. */
  readonly service?: ServiceBridge;
  /**
   * Panel-only system file search: opaque result ids and home-relative folders, never paths.
   * Absent in the macOS shell (until the service serves file search), the renderer preview and
   * tests, where the file group reads as unavailable.
   */
  readonly files?: FileSearchBridge;
  show: () => Promise<void>;
  hide: () => Promise<void>;
  getState: () => Promise<DesktopState>;
  setPinned: (pinned: boolean) => Promise<boolean>;
  /** macOS only: keeps or removes the Dock icon. */
  setShowInDock: (show: boolean) => Promise<boolean>;
  /**
   * Packaged macOS and Windows builds only: registers or removes the OS login item and resolves to
   * the applied state, which stays false while macOS waits for approval in System Settings.
   */
  setOpenAtLogin: (open: boolean) => Promise<boolean>;
  chooseFiles: () => Promise<ContextFile[]>;
  /**
   * Edit → Undo/Redo from the application menu; returns the unsubscribe. The renderer moves the
   * focused CodeMirror editor's history or runs the native command. Optional for test compat.
   */
  onEditCommand?: (listener: (command: EditCommand) => void) => () => void;
}
