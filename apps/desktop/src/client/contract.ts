import type {
  FileSearchQuery,
  FileSearchReply,
  FolderRef,
  OnboardingProgress,
  QueueState,
} from '@atd/agent-contracts';
import type { AgentBridge } from './agent/bridge';
import type { AddonsBridge } from './addons-contract';
import type { AppsBridge } from './apps-contract';
import type { AutomationsBridge } from './automations-contract';
import type { ComputerBridge } from './computer-contract';
import type { Screenshot } from './agent/screenshot-input';
import type { FileRef } from './agent/task-schema';
import type { NotificationsBridge } from './notifications-contract';
import type { MiniPanelOpenOn, PanelPlacement, SettingsBridge } from './settings-contract';
import type { ServiceBridge } from './service/ipc';

/** Application menu edits the renderer runs itself (`lib/edit-commands.ts`). */
export type EditCommand = 'undo' | 'redo';

/** Messages an exact native run cancellation withdrew, destined for that task's draft. */
export interface TaskQueueWithdrawn {
  taskId: string;
  runId: string;
  unsent: QueueState;
}

export interface ContextFile {
  name: string;
  size: number;
  type: string;
}

/** The panel's `@` file search through the service's file routes, and its pasted text files. */
export interface FileSearchBridge {
  /** An empty query returns recent files only. */
  search(request: FileSearchQuery): Promise<FileSearchReply>;
  /** Creates resources from the files behind the ids; rejects with English messages. */
  attach(resultIds: string[]): Promise<FileRef[]>;
  /** Stores `text` as a UTF-8 text resource named `name`; rejects with an English message. */
  saveText(name: string, text: string): Promise<FileRef>;
}

/**
 * Why the shell did not add an item: a file import (`unreadable`, `unsupported`, `tooLarge`), a
 * folder registration (`unreadable`, `notDirectory`, `forbidden` for a folder no task may read), a
 * request that failed as a whole (`failed`), or an item past what one gesture adds (`tooMany`).
 */
export type ImportFailureReason =
  | 'unreadable'
  | 'unsupported'
  | 'tooLarge'
  | 'notDirectory'
  | 'forbidden'
  | 'failed'
  | 'tooMany';

/** An item the shell did not add: its basename (the page never sees paths of refused items). */
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

/**
 * Where a newer version of the app stands: downloading in the background (`percent` in whole
 * steps, null while the size is unknown), being unpacked and checked (`preparing`), or waiting to
 * install (`ready`); `idle` while none is under way.
 */
export type AppUpdateState =
  | { phase: 'idle' }
  | { phase: 'downloading'; version: string; percent: number | null }
  | { phase: 'preparing'; version: string }
  | { phase: 'ready'; version: string };

/** A newer version of the app, which the shell downloads, prepares and installs. */
export interface UpdateBridge {
  /** Installs the ready update and relaunches; the shell still asks before stopping running tasks. */
  install(): void;
  /** Shows the update under way in the shell's own update window, with its details and Cancel. */
  show(): void;
  /** The update's state on every change and once on subscribe; returns the unsubscribe. */
  onState(listener: (state: AppUpdateState) => void): () => void;
}

/** The running app as the settings window's About page shows it. */
export interface AppAbout {
  /** The marketing version, such as `0.9.0`. */
  version: string;
  /** The build number updates compare. */
  build: string;
  /** Whether `checkForUpdates` does anything: false in development builds, which never update. */
  updates: boolean;
}

/** The running app's identity and a user-requested update check, in every window. */
export interface AboutBridge {
  info(): Promise<AppAbout>;
  /** Checks for updates with the shell's own progress and result windows. */
  checkForUpdates(): void;
}

/**
 * A generative view's window to open: the view's task and `show_ui` call, the window's title, and
 * its preferred size in points, title bar included (`show_ui` `window`), each side null for the
 * shell's default.
 */
export interface ViewWindowRequest {
  taskId: string;
  callId: string;
  title: string;
  width: number | null;
  height: number | null;
}

/** Generative views' windows, which the shell opens, in every window. */
export interface ViewsBridge {
  /** Opens the view's window, or brings its open window forward. */
  open(request: ViewWindowRequest): Promise<void>;
}

/**
 * What the page reaches beyond itself. The macOS shell hosting the renderer in a WKWebView
 * installs it as `window.desktop` (`src/native-host`); tests install their own.
 */
export interface DesktopBridge {
  readonly diagnostics?: import('./diagnostics-contract').DiagnosticsBridge;
  /** The OS as a Node platform name. */
  readonly platform: string;
  /** Pauses native shortcuts until the returned release runs. Absent in renderer-only tests. */
  beginShortcutRecording?: () => Promise<() => void>;
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
  /** The user apps the agent built and their windows; absent in tests that need none. */
  readonly apps?: AppsBridge;
  /** Saved prompts and commands that start their own tasks; absent in tests that need none. */
  readonly automations?: AutomationsBridge;
  /** Optional downloadable parts of the product; absent in tests that need none. */
  readonly addons?: AddonsBridge;
  /** Browser and computer use: targets, stopping, live progress; absent in tests that need none. */
  readonly computer?: ComputerBridge;
  /** The shell's task notifications and their settings; absent in tests that need none. */
  readonly notifications?: NotificationsBridge;
  /** Generative views' windows; absent in tests that need none. */
  readonly views?: ViewsBridge;
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
  /**
   * Shows or hides the mini panel on the screen edge and resolves to the applied state, which
   * `SettingsSnapshot.miniPanelShown` follows. Optional for test compat.
   */
  setMiniPanelShown?: (shown: boolean) => Promise<boolean>;
  /**
   * Sets how the mini panel opens and resolves to the applied value, which
   * `SettingsSnapshot.miniPanelOpenOn` follows. Optional for test compat.
   */
  setMiniPanelOpenOn?: (openOn: MiniPanelOpenOn) => Promise<MiniPanelOpenOn>;
  /**
   * Sets where summons show the panel and resolves to the applied value, which
   * `SettingsSnapshot.panelPlacement` follows; a visible panel stays put until the next summon.
   * Optional for test compat.
   */
  setPanelPlacement?: (placement: PanelPlacement) => Promise<PanelPlacement>;
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
  /** The About page's app details; absent in tests that need none. */
  readonly about?: AboutBridge;
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
   * The mini panel's New task, which the shell hands to the panel page only, without showing the
   * panel (absent in the settings window and in tests); returns the unsubscribe. The page starts a
   * new task as its own New task button does, then shows the panel. A request that arrived before
   * anything subscribed reaches the first subscriber.
   */
  onNewTask?: (listener: () => void) => () => void;
  /**
   * The selection toolbar's Ask Atd, which the shell hands to the panel page only after it
   * captured the selection and showed the panel (absent in the settings window and in tests);
   * returns the unsubscribe. The page takes the capture, quotes it and focuses the composer.
   */
  onSelectionAsk?: (listener: () => void) => () => void;
  /**
   * Tasks the shell asks the panel to show, after the person opened an automation's notification
   * (panel only; absent in the other windows and in tests); returns the unsubscribe. A request
   * that arrived before anything subscribed reaches the first subscriber.
   */
  onTaskOpen?: (listener: (taskId: string) => void) => () => void;
  /** Native Stop's withdrawn messages; panel only, held until its draft owner subscribes. */
  onTaskQueueWithdrawn?: (listener: (event: TaskQueueWithdrawn) => void) => () => void;
  /** The welcome guide window's own controls; present only in that window. */
  readonly onboarding?: OnboardingBridge;
}

/** What the welcome guide window can do beyond the settings every window shares. */
export interface OnboardingBridge {
  /** Reads durable progress before the guide mounts; null starts a new guide. */
  getProgress: () => Promise<OnboardingProgress | null>;
  /** Resolves only once progress is saved, before an external permission prompt can restart us. */
  saveProgress: (progress: OnboardingProgress) => Promise<void>;
  /** Records an explicit finish/dismissal, then closes; `summon` shows the panel. */
  close: (summon: boolean) => Promise<void>;
  /** The full-screen intro ended: the guide's window drops to the normal level. */
  settle: () => Promise<void>;
  /**
   * Where the guide's glass surface is (the opening page's or the card's), in CSS pixels from the
   * viewport's top-left, with its corner radius, so the shell lays the window glass under it;
   * `null` hides that glass. Hidden glass fades in, and `null` fades it out, over `fade` seconds;
   * shown glass moves at once.
   */
  surface: (rect: SurfaceRect | null, radius: number, fade: number) => void;
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
