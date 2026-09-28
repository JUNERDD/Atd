import { PathEscapeError, type FsEntry, type ReadonlyFs } from '../../src/ports.js';

export interface MemoryFsOptions {
  /**
   * Entries that exist in listings but resolve outside the root (like a symlink to `/etc`):
   * every read, stat or list at or below them throws `PathEscapeError`.
   */
  escapes?: Record<string, FsEntry['kind']>;
}

/**
 * A `ReadonlyFs` over an in-memory tree. Keys are root-relative POSIX file paths; a key ending in
 * `/` declares an empty directory. Absolute paths and `..` segments throw `PathEscapeError`, as
 * the port contract requires.
 */
export function memoryFs(files: Record<string, string>, options: MemoryFsOptions = {}): ReadonlyFs {
  const escapes = options.escapes ?? {};
  const contents = new Map<string, string>();
  const dirs = new Set<string>(['']);
  const addParents = (path: string) => {
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      dirs.add(segments.slice(0, index).join('/'));
    }
  };
  for (const [key, value] of Object.entries(files)) {
    if (key.endsWith('/')) {
      const dir = key.slice(0, -1);
      dirs.add(dir);
      addParents(dir);
    } else {
      contents.set(key, value);
      addParents(key);
    }
  }
  for (const path of Object.keys(escapes)) addParents(path);

  const resolve = (raw: string): string => {
    if (raw.startsWith('/')) throw new PathEscapeError(raw);
    const segments = raw.split('/').filter((segment) => segment !== '' && segment !== '.');
    if (segments.includes('..')) throw new PathEscapeError(raw);
    const path = segments.join('/');
    const escaped = Object.keys(escapes).some(
      (escape) => path === escape || path.startsWith(`${escape}/`),
    );
    if (escaped) throw new PathEscapeError(raw);
    return path;
  };

  return {
    async readText(raw) {
      const path = resolve(raw);
      const text = contents.get(path);
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    async stat(raw) {
      const path = resolve(raw);
      if (contents.has(path)) return 'file';
      return dirs.has(path) ? 'dir' : null;
    },
    async list(raw) {
      const path = resolve(raw);
      if (!dirs.has(path)) throw new Error(`ENOTDIR: ${path}`);
      const prefix = path === '' ? '' : `${path}/`;
      const entries = new Map<string, FsEntry['kind']>();
      const collect = (candidate: string, kind: FsEntry['kind']) => {
        if (candidate === path || !candidate.startsWith(prefix)) return;
        const rest = candidate.slice(prefix.length);
        if (rest.includes('/')) return;
        entries.set(rest, kind);
      };
      for (const file of contents.keys()) collect(file, 'file');
      for (const dir of dirs) collect(dir, 'dir');
      for (const [escape, kind] of Object.entries(escapes)) collect(escape, kind);
      return [...entries].map(([name, kind]) => ({ name, kind }));
    },
  };
}
