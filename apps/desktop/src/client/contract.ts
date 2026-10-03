import type { FileSearchQuery, FileSearchReply, FolderRef } from '@atd/agent-contracts';
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

/**
 * Why the shell did not import a path: a file import (`unreadable`, `unsupported`, `tooLarge`) or
 * a folder registration (`unreadable`, `notDirectory`, `forbidden` for a folder no task may read).
 */
export type ImportFailureReason =
  | 'unreadable'
  | 'unsupported'
  | 'tooLarge'
  | 'notDirectory'
  | 'forbidden';

/** A path the shell refused: its basename (the page never sees paths of refused items). */
export interface ImportFailure {
  name: string;
  reason: ImportFailureReason;
}

/**
 * The folders tasks may read. The shell alone turns a directory into a folder ref (its open panel,
 * a drop, the Finder service); a submit grants the refs it carries to its task, and the session
 * menu lists and revokes a task's grants.
 */
export interface FolderBridge {
  /** The directory open panel; every pick lands in `folders` or `failures`, both empty on cancel. */
  pick(): Promise<{ folders: FolderRef[]; failures: ImportFailure[] }>;
  /** The folders granted to a task. */
  list(taskId: string): Promise<FolderRef[]>;
  /** Revokes one folder for the task's later runs; resolves with the folders that remain. */
  revoke(taskId: string, folderId: string): Promise<FolderRef[]>;
  /** A task's grants may have changed (its `task` invalidation); returns the unsubscribe. */
  onChange(listener: (taskId: string) => void): () => void;
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

/** A newer version of the app, downloaded by the shell and waiting to install. */
export interface UpdateBridge {
  /** Installs the waiting update and relaunches; the shell still asks before stopping running tasks. */
  install(): void;
  /**
   * The waiting update's version, or null while none waits, on every change and once on subscribe;
   * returns the unsubscribe.
   */
  onState(listener: (version: string | null) => void): () => void;
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
  /** Panel-only readable folders; absent in the settings window and in tests that need none. */
  readonly folders?: FolderBridge;
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
  /** Panel-only app updates; absent in the settings window and in tests. */
  readonly update?: UpdateBridge;
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
  /**
   * The selection toolbar's Ask Atd, which the shell hands to the panel page only after it
   * captured the selection and showed the panel (absent in the settings window and in tests);
   * returns the unsubscribe. The page takes the capture, quotes it and focuses the composer.
   */
  onSelectionAsk?: (listener: () => void) => () => void;
  /** The welcome guide window's own controls; present only in that window. */
  readonly onboarding?: OnboardingBridge;
}

/** What the welcome guide window can do beyond the settings every window shares. */
export interface OnboardingBridge {
  /** Closes the guide; `summon` then shows the panel. */
  close: (summon: boolean) => Promise<void>;
  /** The full-screen intro ended: the guide's window drops to the normal level. */
  settle: () => Promise<void>;
  /**
   * Where the guide's glass surface is (the opening page's or the card's), in CSS pixels from the
   * viewport's top-left, with its corner radius, so the shell lays the window glass under it;
   * `null` hides that glass.
   */
  surface: (rect: SurfaceRect | null, radius: number) => void;
  /**
   * Text selected in the selection step's practice area, with its bounding box in CSS pixels from
   * the viewport's top-left, so the shell shows the real selection toolbar beside it; `null` hides
   * that toolbar (`text` is then empty).
   */
  selection: (rect: SurfaceRect | null, text: string) => void;
  /**
   * Every time the shell shows or hides the panel (as the panel page reports it), so the guide
   * can confirm a hotkey try-out; returns the unsubscribe.
   */
  onPanelVisibility: (listener: (visible: boolean) => void) => () => void;
}

/** A rectangle in CSS pixels from the viewport's top-left. */
export interface SurfaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
