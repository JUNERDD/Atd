import { randomUUID } from 'node:crypto';
import type {
  AttachableExtension,
  FileSearchQuery,
  FileSearchReply,
  FileSearchResult,
  ResourceRef,
} from '@ai/agent-contracts';
import { readAttachable, type AttachableFile } from '../resources/attachable-read.js';
import type { ResourceStore } from '../resources.js';
import type { SearchBackend } from './backend.js';
import { candidatesOf, rankCandidates, tooLarge, type Ranked } from './rank.js';
import { resolveSearchScope, searchableLocation } from './scope.js';

/** Results per reply, whatever limit the client asks for. */
const MAX_RESULTS = 20;
/**
 * Time budget per search; a backend still working at the deadline replies `partial`. The client
 * keeps showing the previous results while a search runs.
 */
const SEARCH_BUDGET_MS = 1500;
/** How long an issued result id stays attachable. */
const RESULT_TTL_MS = 10 * 60 * 1000;
/** Live result ids across all channels; the oldest are evicted first. */
const MAX_RESULT_IDS = 300;

/** Icon family per attachable format. */
const KINDS: Record<AttachableExtension, FileSearchResult['kind']> = {
  txt: 'text',
  md: 'text',
  log: 'text',
  csv: 'data',
  json: 'data',
  yaml: 'data',
  yml: 'data',
  xml: 'data',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  html: 'code',
  css: 'code',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  py: 'code',
};

/** A result id that is unknown to its channel or has expired; the client searches again. */
export class SearchResultGone extends Error {
  override name = 'SearchResultGone';
}

/** A file behind a result id that now resolves outside the search scope. */
export class AttachRefused extends Error {
  override name = 'AttachRefused';
}

interface IssuedResult {
  path: string;
  /** The channel the result was issued to. */
  channel: string;
  expiresAt: number;
}

/**
 * File search for client search surfaces. Absolute paths stay in the result registry: clients
 * receive opaque ids bound to their channel, and attach re-validates the file behind each id
 * before reading and storing it. Queries and paths are never logged or persisted. The backend is
 * created on the first search, so the service starts no index work before anyone searches.
 */
export class FileSearchService {
  private readonly issued = new Map<string, IssuedResult>();
  private readonly searches = new Map<string, AbortController>();
  private backend: SearchBackend | null = null;
  private closed = false;

  constructor(
    private readonly createBackend: () => SearchBackend,
    private readonly resources: Pick<ResourceStore, 'save'>,
    private readonly home: string,
    private readonly platform: NodeJS.Platform,
    /** Monotonic, so wall-clock changes cannot extend or cut short a result's lifetime. */
    private readonly now: () => number = () => performance.now(),
  ) {}

  async search(channel: string, request: FileSearchQuery): Promise<FileSearchReply> {
    if (this.closed) throw new Error('File search is shutting down.');
    // One search per channel: a newer query aborts the older one, whose reply becomes superseded.
    this.searches.get(channel)?.abort();
    const current = new AbortController();
    this.searches.set(channel, current);
    try {
      const scope = await resolveSearchScope(this.home, this.platform);
      // A query typed while the scope resolved replaces this one before any backend work starts.
      if (current.signal.aborted) return { state: 'superseded', results: [] };
      const query = request.query.trim();
      const limit = Math.min(request.limit, MAX_RESULTS);
      this.backend ??= this.createBackend();
      const reply = await this.backend.search({
        query,
        limit,
        scope,
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(SEARCH_BUDGET_MS)]),
      });
      if (current.signal.aborted) return { state: 'superseded', results: [] };
      if (reply.state === 'unavailable')
        return { state: 'unavailable', reason: reply.reason, results: [] };
      // Every hit passes the same filter here, whichever backend produced it.
      const ranked = rankCandidates(query, candidatesOf(reply.hits, scope), Date.now());
      const results = ranked.slice(0, limit).map((entry) => ({
        resultId: this.issue(channel, entry.candidate.hit.path),
        ...resultFields(entry),
      }));
      return { state: reply.state, results };
    } catch {
      if (current.signal.aborted) return { state: 'superseded', results: [] };
      // Backend failures can carry paths, so only a generic message reaches the client.
      throw new Error('File search failed. Try again.');
    } finally {
      if (this.searches.get(channel) === current) this.searches.delete(channel);
    }
  }

  /**
   * Checks every id before touching any file, then reads each file under the attachment rules and
   * confirms its resolved path is still searchable, so a link swapped in after the search cannot
   * reach outside the scope. Resources are stored only after every file passed; a file the rules
   * refuse rejects with `AttachableRejected`.
   */
  async attach(channel: string, resultIds: string[]): Promise<ResourceRef[]> {
    const paths = resultIds.map((resultId) => this.resolve(channel, resultId));
    const scope = await resolveSearchScope(this.home, this.platform);
    const files: AttachableFile[] = [];
    for (const filePath of paths) {
      const file = await readAttachable(filePath);
      if (searchableLocation(scope, file.realPath) === null)
        throw new AttachRefused(
          `${file.name} is outside the searchable folders. Browse for it instead.`,
        );
      files.push(file);
    }
    // No task id: the ledger lets any later run reference the resource.
    const stored: ResourceRef[] = [];
    for (const { name, mime, bytes } of files)
      stored.push(await this.resources.save({ name, mime, bytes }));
    return stored;
  }

  /** Aborts in-flight searches and stops the backend; later searches reject. */
  async close(): Promise<void> {
    this.closed = true;
    for (const search of this.searches.values()) search.abort();
    await this.backend?.close();
  }

  private issue(channel: string, filePath: string): string {
    const now = this.now();
    // Every id shares one lifetime, so insertion order is also expiry order.
    for (const [resultId, entry] of this.issued) {
      if (entry.expiresAt > now && this.issued.size < MAX_RESULT_IDS) break;
      this.issued.delete(resultId);
    }
    const resultId = randomUUID();
    this.issued.set(resultId, { path: filePath, channel, expiresAt: now + RESULT_TTL_MS });
    return resultId;
  }

  private resolve(channel: string, resultId: string): string {
    const entry = this.issued.get(resultId);
    // Another channel's id reads as unknown, so ids cannot be probed across windows.
    if (!entry || entry.channel !== channel)
      throw new SearchResultGone('This search result is no longer available. Search again.');
    if (entry.expiresAt <= this.now()) {
      this.issued.delete(resultId);
      throw new SearchResultGone('This search result expired. Search again.');
    }
    return entry.path;
  }
}

/** Client-safe metadata: a name and a location, never the path. */
function resultFields({ candidate, match }: Ranked): Omit<FileSearchResult, 'resultId'> {
  const { hit, name, location, extension } = candidate;
  const oversized = tooLarge(hit, extension);
  return {
    name,
    location,
    kind: KINDS[extension],
    size: hit.size,
    modifiedAt: hit.modifiedAt,
    usedAt: hit.usedAt,
    source: hit.source,
    attachable: !oversized,
    ...(oversized ? { reason: 'tooLarge' as const } : {}),
    // Ranking settles on one occurrence per name: the one that placed the file.
    ...(match ? { match: [match] } : {}),
  };
}
