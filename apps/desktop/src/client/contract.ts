import type { FileSearchQuery, FileSearchReply } from '@ai/agent-contracts';
import type { AgentBridge } from './agent/bridge';
import type { FileRef } from './agent/task-schema';
import type { SettingsBridge } from './settings-contract';
import type { ServiceBridge } from './service/ipc';

/** Application menu edits the renderer runs itself (`lib/edit-commands.ts`). */
export type EditCommand = 'undo' | 'redo';

export interface ContextFile {
  name: string;
  size: number;
  type: string;
}

/** The panel's `@` file search through the service's file routes. */
export interface FileSearchBridge {
  /** An empty query returns recent files only. */
  search(request: FileSearchQuery): Promise<FileSearchReply>;
  /** Creates resources from the files behind the ids; rejects with English messages. */
  attach(resultIds: string[]): Promise<FileRef[]>;
}

export interface DesktopState {
  pinned: boolean;
  shortcut: string;
  /** Whether the shell registered the panel shortcut; null until the panel reports it. */
  shortcutAvailable: boolean | null;
}

/**
 * What the page reaches beyond itself. The macOS shell hosting the renderer in a WKWebView
 * installs it as `window.desktop` (`src/native-host`); tests install their own.
 */
export interface DesktopBridge {
  /** The OS as a Node platform name. */
  readonly platform: string;
  readonly settings: SettingsBridge;
  readonly agent: AgentBridge;
  /** T6 narrow service channel: status/skills/roles/MCP. No token crosses. Optional for test compat. */
  readonly service?: ServiceBridge;
  /**
   * Panel-only system file search: opaque result ids and home-relative folders, never paths.
   * Absent in the settings window and in tests, where the file group reads as unavailable.
   */
  readonly files?: FileSearchBridge;
  show: () => Promise<void>;
  hide: () => Promise<void>;
  getState: () => Promise<DesktopState>;
  setPinned: (pinned: boolean) => Promise<boolean>;
  /** Keeps or removes the Dock icon. */
  setShowInDock: (show: boolean) => Promise<boolean>;
  /**
   * Registers or removes the login item and resolves to the applied state, which stays false while
   * macOS waits for approval in System Settings.
   */
  setOpenAtLogin: (open: boolean) => Promise<boolean>;
  chooseFiles: () => Promise<ContextFile[]>;
  /**
   * Edit → Undo/Redo from the application menu; returns the unsubscribe. The renderer moves the
   * focused CodeMirror editor's history or runs the native command. Optional for test compat.
   */
  onEditCommand?: (listener: (command: EditCommand) => void) => () => void;
}
