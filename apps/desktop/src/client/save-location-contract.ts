/** Capture surfaces that share the shell's save-location preference and folder picker. */
export type SaveLocationKind = 'screenshot' | 'recording';

/** One remembered save folder: its resolved path, folder name, and abbreviated display path. */
export interface SaveLocationFolder {
  readonly path: string;
  readonly name: string;
  readonly displayPath: string;
}

/** Current save-location preference (`null` means ask each time) and remembered folders. */
export interface SaveLocationState {
  readonly current: string | null;
  readonly folders: readonly SaveLocationFolder[];
}

/**
 * The shell's save-location preference and native folder picker for screenshots and recordings.
 * The shell persists the choice in macOS user defaults and prunes missing folders locally.
 */
export interface SaveLocationBridge {
  /** Reads the current save-location preference and remembered folders for `kind`. */
  state(kind: SaveLocationKind): Promise<SaveLocationState>;
  /** Selects `path` (or `null` for ask each time) for `kind` and resolves to the applied state. */
  set(kind: SaveLocationKind, path: string | null): Promise<SaveLocationState>;
  /** Opens a native folder picker for `kind` and resolves to the applied state. */
  pick(kind: SaveLocationKind): Promise<SaveLocationState>;
}
