import { createHmac, randomBytes } from 'node:crypto';
import {
  attachmentMime,
  fileFormat,
  MAX_ATTACHMENT_BYTES,
  type FileSearchQuery,
  type FileSearchReply,
  type FileSearchResult,
  type ResourceRef,
} from '@atd/agent-contracts';
import { inspectAttachable, readInspected } from '../resources/attachable-read.js';
import type { NewResource, ResourceStore } from '../resources.js';
import type { SearchBackend, SearchHit } from './backend.js';
import { offeredLocation, resolveSearchScope, type ScopeRoots, type SearchScope } from './scope.js';

/** Results per reply, whatever limit the client asks for. */
const MAX_RESULTS = 20;
/** Hits asked beyond the rows shown, so files the scope keeps out do not leave the list short. */
const FILTER_HEADROOM = 10;
/**
 * Time budget per search; a backend still working at the deadline replies `partial`, or
 * `indexing` while the index opens. The client keeps showing the previous results meanwhile.
 */
const SEARCH_BUDGET_MS = 1500;
/** How long an issued result id stays attachable after the latest reply that listed it. */
const RESULT_TTL_MS = 10 * 60 * 1000;
/** Live result ids across all channels; the oldest are evicted first. */
const MAX_RESULT_IDS = 300;

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
 * File search for client search surfaces. The index decides which files match and in what order;
 * the service keeps out files outside its scope, marks those too large to attach, and trims the
 * list, without reordering it. Absolute paths stay in the result registry: clients receive
 * opaque ids bound to their channel, and attach re-validates the file behind each id before
 * reading and storing it. Queries and paths are never logged or persisted.
 */
export class FileSearchService {
  private readonly issued = new Map<string, IssuedResult>();
  private readonly searches = new Map<string, AbortController>();
  /** Keys result ids, so they are opaque and differ between channels and service runs. */
  private readonly idKey = randomBytes(32);
  private backend: SearchBackend | null = null;
  private closed = false;

  constructor(
    private readonly createBackend: () => SearchBackend,
    private readonly resources: Pick<ResourceStore, 'saveAll'>,
    private readonly roots: ScopeRoots,
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
      const scope = await resolveSearchScope(this.roots);
      // A query typed while the scope resolved replaces this one before any backend work starts.
      if (current.signal.aborted) return { state: 'superseded', results: [] };
      const limit = Math.min(request.limit, MAX_RESULTS);
      const reply = await this.backendOf().search({
        query: request.query.trim(),
        limit: limit + FILTER_HEADROOM,
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(SEARCH_BUDGET_MS)]),
      });
      if (current.signal.aborted) return { state: 'superseded', results: [] };
      if (reply.state === 'unavailable')
        return { state: 'unavailable', reason: reply.reason, results: [] };
      return { state: reply.state, results: this.resultsOf(channel, scope, reply.hits, limit) };
    } catch {
      if (current.signal.aborted) return { state: 'superseded', results: [] };
      // Backend failures can carry paths, so only a generic message reaches the client.
      throw new Error('File search failed. Try again.');
    } finally {
      if (this.searches.get(channel) === current) this.searches.delete(channel);
    }
  }

  /**
   * Resumes an index an earlier search left on disk, so the first search after a restart need not
   * wait for it to load. Nothing waits for this, and a fresh data dir starts nothing.
   */
  warm(): void {
    if (!this.closed) void this.backendOf().warm();
  }

  /**
   * Checks every id before touching any file, then reads each file under the attachment rules and
   * confirms its resolved path is still in scope, so a link swapped in after the search cannot
   * reach outside it. Each file is stored as soon as it passes, so one file at a time is held in
   * memory, yet the resources exist only once every file passed: a file the rules refuse rejects
   * with `AttachableRejected`, and the store removes the files stored before it.
   */
  async attach(channel: string, resultIds: string[]): Promise<ResourceRef[]> {
    const paths = resultIds.map((resultId) => this.resolve(channel, resultId));
    const scope = await resolveSearchScope(this.roots);
    return this.resources.saveAll(attachableFiles(paths, scope));
  }

  /** Aborts in-flight searches and stops the backend; later searches reject. */
  async close(): Promise<void> {
    this.closed = true;
    for (const search of this.searches.values()) search.abort();
    await this.backend?.close();
  }

  private backendOf(): SearchBackend {
    return (this.backend ??= this.createBackend());
  }

  /** The first `limit` hits the scope allows, in the index's order, as client-safe results. */
  private resultsOf(
    channel: string,
    scope: SearchScope,
    hits: SearchHit[],
    limit: number,
  ): FileSearchResult[] {
    const results: FileSearchResult[] = [];
    for (const hit of hits) {
      if (results.length === limit) break;
      const location = offeredLocation(scope, hit.path);
      const resultId = location === null ? null : this.issue(channel, hit);
      if (location !== null && resultId !== null) results.push(resultOf(resultId, hit, location));
    }
    return results;
  }

  /**
   * The file's result id for this channel: derived from the index's id for its path, so every
   * reply names the same file with the same id and the panel keeps its rows (and its highlight)
   * steady. Listing a file again renews its lifetime.
   */
  private issue(channel: string, hit: SearchHit): string | null {
    const resultId = createHmac('sha256', this.idKey)
      .update(`${channel}\n${hit.id}`)
      .digest('base64url')
      .slice(0, 32);
    // Two paths with one index id would share a result id; neither may stand in for the other.
    const known = this.issued.get(resultId);
    if (known && known.path !== hit.path) return null;
    this.issued.delete(resultId);
    const now = this.now();
    // Every id shares one lifetime and a renewed id moves to the end, so insertion order is
    // also expiry order.
    for (const [issuedId, entry] of this.issued) {
      if (entry.expiresAt > now && this.issued.size < MAX_RESULT_IDS) break;
      this.issued.delete(issuedId);
    }
    this.issued.set(resultId, { path: hit.path, channel, expiresAt: now + RESULT_TTL_MS });
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

/** The files behind `paths` under the attachment rules; one resolved outside `scope` is refused. */
async function* attachableFiles(paths: string[], scope: SearchScope): AsyncGenerator<NewResource> {
  for (const filePath of paths) {
    const file = await inspectAttachable(filePath);
    if (offeredLocation(scope, file.realPath) === null)
      throw new AttachRefused(
        `${file.name} is outside the searchable folders. Browse for it instead.`,
      );
    // No task id: the ledger lets any later run reference the resource. With its source the store
    // reuses an unchanged copy without reading the file, and a run sent later reads a changed one
    // again (resources/refresh.ts), as for a picked or dropped file.
    yield {
      name: file.name,
      mime: attachmentMime(file.name),
      ...(file.source ? { source: file.source } : {}),
      read: () => readInspected(file),
    };
  }
}

/**
 * Client-safe metadata: a name and a location, never the path. A file too large to attach keeps
 * its place in the list and says why it cannot be picked.
 */
function resultOf(resultId: string, hit: SearchHit, location: string): FileSearchResult {
  const tooLarge = hit.size !== null && hit.size > MAX_ATTACHMENT_BYTES;
  return {
    resultId,
    name: hit.name,
    location,
    kind: fileFormat(hit.name)?.kind ?? null,
    size: hit.size,
    modifiedAt: hit.modifiedAt,
    attachable: !tooLarge,
    ...(tooLarge ? { reason: 'tooLarge' as const } : {}),
    ...(hit.matches.length ? { match: hit.matches } : {}),
  };
}
