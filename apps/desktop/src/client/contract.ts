import type { FileSearchQuery, FileSearchReply } from '@atd/agent-contracts';
import type { AgentBridge } from './agent/bridge';
import type { Screenshot } from './agent/screenshot-input';
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

/** A rectangle in page CSS pixels from the web view's top-left, as `getBoundingClientRect` reports. */
export interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Reading text aloud with the system voice; one text at a time, a new one replaces the last. */
export interface SpeechBridge {
  speak(text: string): Promise<void>;
  stop(): Promise<void>;
  /** Whether the shell is reading aloud, on every change and once on subscribe; returns the unsubscribe. */
  onState(listener: (speaking: boolean) => void): () => void;
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
   * Captures the screen for a screenshot command's input with the commands' own capture (the one
   * preparing a command uses); null when the user cancelled. Rejects with an English message when
   * Screen Recording is not permitted or the import fails.
   */
  screenshot: () => Promise<Screenshot | null>;
  /**
   * Reopens an image attachment (`resourceId`) on the capture overlay for more annotation and
   * cropping and imports the result as a new resource (`context` is always null); null when the
   * user cancelled, which leaves the attachment as it was. Rejects like `screenshot`.
   */
  editScreenshot: (resourceId: string) => Promise<Screenshot | null>;
  /** A stored resource's bytes through the relay (`GET /v1/resources/:id`), typed by its mime. */
  resource: (resourceId: string) => Promise<Blob>;
  /** The system share picker for `text`, shown at `anchor`. Optional for test compat. */
  share?: (text: string, anchor: AnchorRect) => Promise<void>;
  /** Optional for test compat. */
  readonly speech?: SpeechBridge;
  /**
   * Edit → Undo/Redo from the application menu; returns the unsubscribe. The renderer moves the
   * focused CodeMirror editor's history or runs the native command. Optional for test compat.
   */
  onEditCommand?: (listener: (command: EditCommand) => void) => () => void;
  /**
   * The global screenshot shortcut, which the shell hands to the panel page only (absent in the
   * settings window and in tests); returns the unsubscribe. The page takes the screenshot itself.
   */
  onScreenshotShortcut?: (listener: () => void) => () => void;
}
