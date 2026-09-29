import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachableExtension } from '@ai/agent-contracts';
import type { SearchHit } from './backend.js';

/** Newest entries read from the desktop's recent list before any file is touched. */
const MAX_RECENTS = 100;

interface RecentFile {
  path: string;
  usedAt: number | null;
}

/**
 * Files the Linux desktop recently opened, as hits with real paths and current stats. Entries
 * whose file is gone, or is not an attachable type, are skipped.
 */
export async function recentHits(home: string): Promise<SearchHit[]> {
  const recents = await xdgRecents(home);
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
