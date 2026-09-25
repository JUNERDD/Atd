import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ATTACHABLE_EXTENSIONS, attachableExtension } from '../agent/attachable-rules';
import type { BackendReply, SearchBackend, SearchHit, SearchRequest } from './backend';
import { foldText, nameMatches } from './rank';
import { isExcludedDirectory, searchableLocation, type SearchScope } from './scope';

/** Read in this order, from the tail of each record, because paths can contain spaces. */
const ATTRIBUTES = ['kMDItemFSSize', 'kMDItemFSContentChangeDate', 'kMDItemLastUsedDate'] as const;
/** A pass ends at whichever limit it reaches first; broad queries deliver their first batch late. */
const PASS_BUDGET_MS = 1200;
const PASS_RECORD_CAP = 2000;
const EXTENSIONS = `(${ATTACHABLE_EXTENSIONS.map((extension) => `kMDItemFSName == "*.${extension}"c`).join(' || ')})`;
/** Empty and one-character queries: files used within 30 days, topped up with files modified within 3. */
const RECENT_PASSES = [
  `kMDItemLastUsedDate >= $time.today(-30) && ${EXTENSIONS}`,
  `kMDItemFSContentChangeDate >= $time.today(-3) && ${EXTENSIONS}`,
];
const STATUS_TTL_MS = 60 * 1000;

interface Pass {
  hits: SearchHit[];
  /** False when a limit or the request signal ended the pass early. */
  complete: boolean;
}

/**
 * Searches file names through the system Spotlight index with `/usr/bin/mdfind`. It never walks
 * folders, so there is no traversal fallback: with indexing off the search is unavailable.
 */
export class SpotlightBackend implements SearchBackend {
  private status: { checkedAt: number; enabled: Promise<boolean> } | null = null;

  async search({ query, limit, scope, signal }: SearchRequest): Promise<BackendReply> {
    if (!(await this.indexEnabled(scope.home)))
      return { state: 'unavailable', reason: 'indexDisabled' };
    const { folders, files } = await homeEntries(scope);
    // `*` cannot be escaped inside a query value, and control characters would end it.
    const text = query.replace(/[*\p{Cc}]/gu, '');
    // Spotlight's word and wildcard rules differ from ours, so every name is checked again here.
    const usable = (filePath: string) =>
      searchableLocation(scope, filePath) !== null &&
      (!text || nameMatches(text, path.basename(filePath)));
    const passes = { folders, limit, usable, signal };
    // Recently modified files only top up a short list: installs and builds touch thousands at once.
    if ([...foldText(text)].length <= 1) return runPasses(passes, RECENT_PASSES, 'recent', []);
    const value = text.replace(/["\\]/g, '\\$&');
    return runPasses(
      passes,
      [
        `kMDItemFSName == "${value}*"cdw && ${EXTENSIONS}`,
        `kMDItemFSName == "*${value}*"cd && ${EXTENSIONS}`,
      ],
      'search',
      await homeFileHits(files, usable),
    );
  }

  /** Re-checked at most once a minute; concurrent searches share one check. */
  private indexEnabled(home: string): Promise<boolean> {
    const now = performance.now();
    if (!this.status || now - this.status.checkedAt >= STATUS_TTL_MS)
      this.status = { checkedAt: now, enabled: checkIndex(home) };
    return this.status.enabled;
  }
}

interface Passes {
  folders: string[];
  limit: number;
  usable: (filePath: string) => boolean;
  signal: AbortSignal;
}

/**
 * Runs the queries in order after `seed`: the first always, each later one only while fewer than
 * `limit` usable hits are in hand. The reply is complete only when every pass that ran finished.
 */
async function runPasses(
  { folders, limit, usable, signal }: Passes,
  queries: string[],
  source: SearchHit['source'],
  seed: SearchHit[],
): Promise<BackendReply> {
  const hits = [...seed];
  // Without -onlyin, mdfind would search every volume.
  if (!folders.length) return { state: 'ok', hits };
  let complete = true;
  for (const [index, query] of queries.entries()) {
    if (index > 0 && hits.length >= limit) break;
    if (signal.aborted) {
      complete = false;
      break;
    }
    const pass = await runPass(folders, query, source, signal);
    hits.push(...pass.hits.filter((hit) => usable(hit.path)));
    complete &&= pass.complete;
  }
  return { state: complete ? 'ok' : 'partial', hits };
}

/**
 * Home's own entries, read without descending: the folders searched with -onlyin (never Library,
 * plus iCloud Drive) and the files directly in home, which no -onlyin folder covers. Links are
 * neither files nor folders here.
 */
async function homeEntries(scope: SearchScope): Promise<{ folders: string[]; files: string[] }> {
  const entries = await readdir(scope.home, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory() && !isExcludedDirectory(scope, entry.name, true))
    .map((entry) => path.join(scope.home, entry.name));
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(scope.home, entry.name));
  return { folders: scope.iCloud ? [...folders, scope.iCloud] : folders, files };
}

/**
 * Name matches among the files directly in home, with their stats. They join name queries only:
 * without Spotlight there is no usage date to list them as recent files.
 */
async function homeFileHits(
  files: string[],
  usable: (filePath: string) => boolean,
): Promise<SearchHit[]> {
  const hits = await Promise.all(
    files
      .filter((file) => attachableExtension(file) && usable(file))
      .map(async (file): Promise<SearchHit | null> => {
        const info = await stat(file).catch(() => null);
        if (!info?.isFile()) return null;
        const modifiedAt = Math.round(info.mtimeMs);
        return { path: file, size: info.size, modifiedAt, usedAt: null, source: 'search' };
      }),
  );
  return hits.filter((hit) => hit !== null);
}

/** Runs one query without a shell and reads NUL-separated records until a limit is reached. */
function runPass(
  folders: string[],
  query: string,
  source: SearchHit['source'],
  signal: AbortSignal,
): Promise<Pass> {
  if (signal.aborted) return Promise.resolve({ hits: [], complete: false });
  const args = [
    '-0',
    ...ATTRIBUTES.flatMap((attribute) => ['-attr', attribute]),
    ...folders.flatMap((folder) => ['-onlyin', folder]),
    query,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/mdfind', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const hits: SearchHit[] = [];
    let records = 0;
    let pending = Buffer.alloc(0);
    let cut = false;
    const stop = () => {
      if (cut) return;
      cut = true;
      child.kill();
    };
    const timer = setTimeout(stop, PASS_BUDGET_MS);
    signal.addEventListener('abort', stop, { once: true });
    const settle = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (cut) return;
      pending = Buffer.concat([pending, chunk]);
      // NUL never occurs inside a UTF-8 sequence, so splitting the bytes first is safe.
      for (let end = pending.indexOf(0); end !== -1 && !cut; end = pending.indexOf(0)) {
        const hit = parseRecord(pending.toString('utf8', 0, end), source);
        pending = pending.subarray(end + 1);
        if (hit) hits.push(hit);
        records += 1;
        if (records >= PASS_RECORD_CAP) stop();
      }
    });
    child.once('error', (error) => {
      settle();
      reject(error);
    });
    child.once('close', (code) => {
      settle();
      if (!cut && code !== 0) reject(new Error(`mdfind exited with code ${String(code)}.`));
      else resolve({ hits, complete: !cut });
    });
  });
}

/** Records read `<path>   kMDItemFSSize = 12   kMDItemFSContentChangeDate = …`; values may be (null). */
function parseRecord(record: string, source: SearchHit['source']): SearchHit | null {
  let rest = record;
  const values: Partial<Record<(typeof ATTRIBUTES)[number], string>> = {};
  for (const attribute of [...ATTRIBUTES].reverse()) {
    const marker = `   ${attribute} = `;
    const at = rest.lastIndexOf(marker);
    if (at === -1) return null;
    values[attribute] = rest.slice(at + marker.length);
    rest = rest.slice(0, at);
  }
  if (!path.isAbsolute(rest)) return null;
  const size = values.kMDItemFSSize;
  return {
    path: rest,
    size: size && /^\d+$/.test(size) ? Number(size) : null,
    modifiedAt: parseDate(values.kMDItemFSContentChangeDate),
    usedAt: parseDate(values.kMDItemLastUsedDate),
    source,
  };
}

/** Dates print as `2026-09-23 07:34:56 +0000`. */
function parseDate(value: string | undefined): number | null {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  if (!match) return null;
  const time = Date.parse(`${match[1]}T${match[2]}${match[3]}:${match[4]}`);
  return Number.isNaN(time) ? null : time;
}

/**
 * Asks mdutil about the volume that holds home. Only an explicit "disabled" answer makes search
 * unavailable; an unknown state or a failed probe lets mdfind run and report for itself.
 */
async function checkIndex(home: string): Promise<boolean> {
  const volume = (await mountPoint(home)) ?? home;
  return !/disabled/i.test(await capture('/usr/bin/mdutil', ['-s', volume]));
}

/** `df -P` prints the mount point in its last column; mdutil only answers for mount points. */
async function mountPoint(target: string): Promise<string | null> {
  const line = (await capture('/bin/df', ['-P', target])).split('\n')[1] ?? '';
  return line.match(/^.+?\s+\d+\s+\d+\s+\d+\s+\d+%\s+(\/.*)$/)?.[1] ?? null;
}

/** A short command's stdout; a failure or a two-second timeout reads as empty output. */
function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    child.once('error', () => resolve(''));
    child.once('close', () => resolve(output));
  });
}
