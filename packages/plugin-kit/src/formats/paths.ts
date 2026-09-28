/** Root-relative POSIX path helpers. '' is the plugin root. */

/** Joins root-relative segments, ignoring empty ones. */
export function joinPath(...parts: string[]): string {
  return parts.filter((part) => part !== '' && part !== '.').join('/');
}

export function baseName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

export function dirName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/**
 * Normalizes a path written inside a bundle to a root-relative POSIX path: drops `./` and empty
 * segments and trailing slashes. Returns null for an absolute path or any `..` segment, which the
 * caller reports as `path-escape`.
 */
export function normalizeRelative(raw: string): string | null {
  const unified = raw.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[A-Za-z]:\//.test(unified)) return null;
  const segments = unified.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) return null;
  return segments.join('/');
}

/** Result of reading a manifest-declared path (`./x`). */
export type ManifestPath = { ok: true; path: string } | { ok: false; reason: 'escape' | 'prefix' };

/**
 * Claude manifest paths must start with `./` (or be `.` / `./` when `allowRoot`) and stay inside
 * the root.
 */
export function readManifestPath(raw: string, allowRoot = false): ManifestPath {
  if (allowRoot && (raw === '.' || raw === './')) return { ok: true, path: '' };
  if (!raw.startsWith('./')) return { ok: false, reason: 'prefix' };
  const path = normalizeRelative(raw);
  if (path === null) return { ok: false, reason: 'escape' };
  return { ok: true, path };
}

/** Path shown in diagnostics and stored in components; the root itself is `.`. */
export function displayPath(path: string): string {
  return path === '' ? '.' : path;
}
