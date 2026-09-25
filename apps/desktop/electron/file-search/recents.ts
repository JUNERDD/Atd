import { shell } from 'electron';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachableExtension } from '../agent/attachable-rules';
import type { SearchHit } from './backend';

/** Newest entries read from the desktop's recent list before any file is touched. */
const MAX_RECENTS = 100;

interface RecentFile {
  path: string;
  usedAt: number | null;
}

/**
 * Files the desktop shell recently opened, as hits with real paths and current stats. Entries
 * whose file is gone, or is not an attachable type, are skipped.
 */
export async function recentHits(platform: NodeJS.Platform, home: string): Promise<SearchHit[]> {
  const recents = platform === 'win32' ? await windowsRecents() : await xdgRecents(home);
  const hits = await Promise.all(
    recents.map(async ({ path: filePath, usedAt }): Promise<SearchHit | null> => {
      try {
        const real = await realpath(filePath);
        const info = await stat(real);
        if (!info.isFile()) return null;
        const modifiedAt = Math.round(info.mtimeMs);
        return { path: real, size: info.size, modifiedAt, usedAt, source: 'recent' };
      } catch {
        return null;
      }
    }),
  );
  return hits.filter((hit) => hit !== null);
}

/** `%APPDATA%\Microsoft\Windows\Recent\*.lnk`; a shortcut's own mtime is when it was last used. */
async function windowsRecents(): Promise<RecentFile[]> {
  const appData = process.env.APPDATA;
  if (!appData) return [];
  const folder = path.join(appData, 'Microsoft', 'Windows', 'Recent');
  const names = await readdir(folder).catch((): string[] => []);
  const shortcuts = await Promise.all(
    names
      .filter((name) => name.toLowerCase().endsWith('.lnk'))
      .map(async (name) => {
        const file = path.join(folder, name);
        const info = await stat(file).catch(() => null);
        return info ? { file, usedAt: Math.round(info.mtimeMs) } : null;
      }),
  );
  return shortcuts
    .filter((shortcut) => shortcut !== null)
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, MAX_RECENTS)
    .flatMap(({ file, usedAt }) => {
      try {
        const target = shell.readShortcutLink(file).target;
        return target && attachableExtension(target) ? [{ path: target, usedAt }] : [];
      } catch {
        return [];
      }
    });
}

/** `$XDG_DATA_HOME/recently-used.xbel` (default `~/.local/share`): bookmark `href` + `modified`. */
async function xdgRecents(home: string): Promise<RecentFile[]> {
  const configured = process.env.XDG_DATA_HOME;
  const dataHome =
    configured && path.isAbsolute(configured) ? configured : path.join(home, '.local', 'share');
  const xml = await readFile(path.join(dataHome, 'recently-used.xbel'), 'utf8').catch(() => '');
  const recents: RecentFile[] = [];
  for (const [tag] of xml.matchAll(/<bookmark\b[^>]*>/g)) {
    const href = attribute(tag, 'href');
    if (!href?.startsWith('file://')) continue;
    let filePath: string;
    try {
      filePath = fileURLToPath(href);
    } catch {
      continue;
    }
    if (!attachableExtension(filePath)) continue;
    const usedAt = Date.parse(attribute(tag, 'modified') ?? '');
    recents.push({ path: filePath, usedAt: Number.isNaN(usedAt) ? null : usedAt });
  }
  return recents.sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0)).slice(0, MAX_RECENTS);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function attribute(tag: string, name: string): string | null {
  const value = tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  return value === undefined
    ? null
    : value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => ENTITIES[entity] ?? '');
}
