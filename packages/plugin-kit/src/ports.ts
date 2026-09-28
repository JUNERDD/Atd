/**
 * Everything the kit needs from its host. The pure entry depends only on these interfaces; the
 * `./node` entry ships default implementations for the generic ones.
 */

/** A directory entry as `ReadonlyFs.list` reports it. Symlinks are resolved by the implementation. */
export interface FsEntry {
  name: string;
  kind: 'file' | 'dir';
}

/**
 * Read-only view of one plugin root. Paths are root-relative POSIX paths ('' is the root). An
 * implementation must reject paths that resolve outside the root, including through symlinks,
 * by throwing `PathEscapeError`.
 */
export interface ReadonlyFs {
  readText(path: string): Promise<string>;
  list(path: string): Promise<FsEntry[]>;
  /** The entry kind, or null when nothing exists at `path`. */
  stat(path: string): Promise<FsEntry['kind'] | null>;
}

/** Thrown by `ReadonlyFs` implementations for a path outside the plugin root. */
export class PathEscapeError extends Error {
  constructor(readonly path: string) {
    super(`Path "${path}" resolves outside the plugin root.`);
    this.name = 'PathEscapeError';
  }
}

/** Secret values for sensitive user config. Keys are `(pluginId, key)`. */
export interface SecretStore {
  get(pluginId: string, key: string): Promise<string | null>;
  set(pluginId: string, key: string, value: string): Promise<void>;
  delete(pluginId: string, key: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
}

export const systemClock: Clock = { now: () => new Date() };
export const silentLogger: Logger = { info: () => {}, warn: () => {} };
