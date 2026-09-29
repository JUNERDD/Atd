import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fdir } from 'fdir';
import { attachableExtension, type AttachableExtension } from '@ai/agent-contracts';
import type { BackendReply, SearchBackend, SearchHit, SearchRequest } from './backend';
import { foldText, nameMatches, rankCandidates, type Candidate } from './rank';
import { recentHits } from './recents';
import { isExcludedDirectory, type SearchScope } from './scope';

const MAX_DEPTH = 8;
const MAX_ENTRIES = 150_000;
const BUILD_BUDGET_MS = 3000;
const STALE_AFTER_MS = 5 * 60 * 1000;

interface Entry {
  /** Real path: the walk follows no links and starts from the resolved home. */
  path: string;
  /** Folded path below home, so one scan matches file and folder names. */
  folded: string;
  /** Where the file name starts in `folded`. */
  nameAt: number;
  /** Folder levels below home. */
  depth: number;
  extension: AttachableExtension;
}

interface Index {
  home: string;
  entries: Entry[];
  /** False when the time budget or the entry cap ended the walk. */
  complete: boolean;
  builtAt: number;
}

interface Build {
  home: string;
  /** Grows while the walk runs, so queries during the first build see a partial index. */
  entries: Entry[];
  done: Promise<void>;
}

/**
 * Windows and Linux file search over an in-memory index of attachable files below home. The first
 * query starts the walk and every query shares it; a stale index keeps answering while a newer
 * one builds in the background.
 */
export class HomeIndexBackend implements SearchBackend {
  private index: Index | null = null;
  private build: Build | null = null;

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async search({ query, limit, scope, signal }: SearchRequest): Promise<BackendReply> {
    const folded = foldText(query);
    // Like Spotlight: empty and one-character queries list recent files only.
    if ([...folded].length <= 1) {
      const recents = await recentHits(this.platform, scope.home);
      return { state: 'ok', hits: recents.filter((hit) => nameMatches(query, name(hit.path))) };
    }
    const { entries, complete } = await this.current(scope, signal);
    // Rank on names first, then stat only the files the reply can show.
    const picked = rankCandidates(query, preselect(entries, folded, limit, scope.home), Date.now());
    const hits = await Promise.all(
      picked.slice(0, limit).map(({ candidate }) => withStats(candidate.hit)),
    );
    return {
      state: complete ? 'ok' : 'partial',
      hits: hits.filter((hit) => hit !== null),
    };
  }

  private async current(
    scope: SearchScope,
    signal: AbortSignal,
  ): Promise<{ entries: Entry[]; complete: boolean }> {
    const index = this.index?.home === scope.home ? this.index : null;
    if (index) {
      if (this.now() - index.builtAt >= STALE_AFTER_MS) this.startBuild(scope);
      return index;
    }
    const build = this.startBuild(scope);
    const finished = await Promise.race([build.done.then(() => true), aborted(signal)]);
    // The walk keeps going after this request ends; later queries get the full index.
    return finished && this.index?.home === scope.home
      ? this.index
      : { entries: build.entries, complete: false };
  }

  private startBuild(scope: SearchScope): Build {
    if (this.build?.home === scope.home) return this.build;
    const entries: Entry[] = [];
    const build: Build = {
      home: scope.home,
      entries,
      // Never rejects: a background rebuild has no caller to report to. A failed walk keeps the
      // previous index, and the next query starts a new walk.
      done: walk(scope, entries)
        .then(
          (complete) => {
            this.index = { home: scope.home, entries, complete, builtAt: this.now() };
          },
          () => undefined,
        )
        .finally(() => {
          if (this.build === build) this.build = null;
        }),
    };
    this.build = build;
    return build;
  }
}

/**
 * Walks home without following links, applying the scope's exclusions and the attachable-type
 * filter during the walk. Resolves true when nothing cut it short.
 */
async function walk(scope: SearchScope, entries: Entry[]): Promise<boolean> {
  const full = new AbortController();
  const budget = AbortSignal.timeout(BUILD_BUDGET_MS);
  await new fdir({ excludeSymlinks: true })
    .withFullPaths()
    .withMaxDepth(MAX_DEPTH)
    .withAbortSignal(AbortSignal.any([budget, full.signal]))
    .exclude((dirName, dirPath) =>
      isExcludedDirectory(scope, dirName, path.dirname(dirPath) === scope.home),
    )
    .filter((filePath) => {
      if (entries.length >= MAX_ENTRIES) full.abort();
      else {
        const entry = toEntry(scope.home, filePath);
        if (entry) entries.push(entry);
      }
      // The index keeps its own entries, so fdir stores nothing.
      return false;
    })
    .crawl(scope.home)
    .withPromise();
  return !budget.aborted && !full.signal.aborted;
}

function toEntry(home: string, filePath: string): Entry | null {
  const fileName = name(filePath);
  const extension = attachableExtension(fileName);
  if (fileName.startsWith('.') || !extension) return null;
  const relative = filePath.slice(home.length + 1);
  const folded = foldText(relative);
  const depth = relative.split(path.sep).length - 1;
  return { path: filePath, folded, nameAt: folded.lastIndexOf(path.sep) + 1, depth, extension };
}

/**
 * Entries whose name contains the query, plus, when those are fewer than `limit`, the shallowest
 * entries that match only by a folder name. Ranking every folder match of a short query would
 * cost far more than the reply can show.
 */
function preselect(entries: Entry[], folded: string, limit: number, home: string): Candidate[] {
  const byName: Candidate[] = [];
  const byFolder: Entry[] = [];
  for (const entry of entries) {
    if (entry.folded.includes(folded, entry.nameAt)) byName.push(toCandidate(entry, home));
    else if (entry.folded.includes(folded)) {
      if (byFolder.length < limit) byFolder.push(entry);
      else {
        const deepest = byFolder.reduce((a, b) => (b.depth > a.depth ? b : a));
        if (entry.depth < deepest.depth) byFolder[byFolder.indexOf(deepest)] = entry;
      }
    }
  }
  if (byName.length >= limit) return byName;
  return [...byName, ...byFolder.map((entry) => toCandidate(entry, home))];
}

function toCandidate(entry: Entry, home: string): Candidate {
  const nameStart = entry.path.lastIndexOf(path.sep);
  return {
    hit: { path: entry.path, size: null, modifiedAt: null, usedAt: null, source: 'search' },
    name: entry.path.slice(nameStart + 1),
    // Home-relative folder, '' for files directly in home.
    location: entry.depth ? entry.path.slice(home.length + 1, nameStart) : '',
    extension: entry.extension,
  };
}

async function withStats(hit: SearchHit): Promise<SearchHit | null> {
  try {
    const info = await stat(hit.path);
    return info.isFile() ? { ...hit, size: info.size, modifiedAt: Math.round(info.mtimeMs) } : null;
  } catch {
    // Removed since the walk.
    return null;
  }
}

function name(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf(path.sep) + 1);
}

function aborted(signal: AbortSignal): Promise<false> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(false);
    else signal.addEventListener('abort', () => resolve(false), { once: true });
  });
}
