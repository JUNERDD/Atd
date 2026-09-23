import { randomUUID } from 'node:crypto';
import type { AgentHttpClient } from '@ai/agent-client';
import {
  readAttachable,
  uploadAttachables,
  type AttachableExtension,
  type AttachableFile,
} from '../agent/attachable-files';
import { notConnected } from '../agent/service-manage';
import type { FileRef } from '../agent/task-schema';
import type { SearchBackend } from './backend';
import type { FileSearchReply, FileSearchRequest, FileSearchResult } from './contract';
import { candidatesOf, rankCandidates, tooLarge, type Candidate } from './rank';
import { resolveSearchScope, searchableLocation } from './scope';

/** Results per reply, whatever limit the renderer asks for. */
const MAX_RESULTS = 20;
/**
 * Time budget per search; a backend still working at the deadline replies `partial`. The renderer
 * keeps showing the previous results while a search runs.
 */
const SEARCH_BUDGET_MS = 1500;
/** How long an issued result id stays attachable. */
const RESULT_TTL_MS = 10 * 60 * 1000;
/** Live result ids across all senders; the oldest are evicted first. */
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
  html: 'code',
  css: 'code',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  py: 'code',
};

/** The part of the service connection an attach needs; the bearer token stays behind it. */
export interface UploadConnection {
  http(): Pick<AgentHttpClient, 'upload'> | null;
}

interface IssuedResult {
  path: string;
  /** The webContents id the result was issued to. */
  sender: number;
  expiresAt: number;
}

/**
 * Main-side file search for the panel. Absolute paths stay in the result registry: the renderer
 * receives opaque ids bound to its webContents, and attach re-validates the file behind each id
 * before reading or uploading it. Queries and paths are never logged or persisted.
 */
export class FileSearchService {
  private readonly issued = new Map<string, IssuedResult>();
  private readonly searches = new Map<number, AbortController>();

  constructor(
    private readonly backend: SearchBackend,
    private readonly connection: UploadConnection,
    private readonly home: string,
    private readonly platform: NodeJS.Platform,
    /** Monotonic, so wall-clock changes cannot extend or cut short a result's lifetime. */
    private readonly now: () => number = () => performance.now(),
  ) {}

  async search(sender: number, request: FileSearchRequest): Promise<FileSearchReply> {
    // One search per sender: a newer query aborts the older one, whose reply becomes superseded.
    this.searches.get(sender)?.abort();
    const current = new AbortController();
    this.searches.set(sender, current);
    try {
      const scope = await resolveSearchScope(this.home, this.platform);
      // A query typed while the scope resolved replaces this one before any backend work starts.
      if (current.signal.aborted) return { state: 'superseded', results: [] };
      const query = request.query.trim();
      const limit = Math.min(request.limit, MAX_RESULTS);
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
      const results = ranked.slice(0, limit).map((candidate) => ({
        resultId: this.issue(sender, candidate.hit.path),
        ...resultFields(candidate),
      }));
      return { state: reply.state, results };
    } catch {
      if (current.signal.aborted) return { state: 'superseded', results: [] };
      // Backend failures can carry paths, so only a generic message reaches the renderer.
      throw new Error('File search failed. Try again.');
    } finally {
      if (this.searches.get(sender) === current) this.searches.delete(sender);
    }
  }

  /**
   * Checks every id before touching any file, then reads each file under the attachment rules and
   * confirms its resolved path is still searchable, so a link swapped in after the search cannot
   * reach outside the scope. Uploads start only after every file passed.
   */
  async attach(sender: number, resultIds: string[]): Promise<FileRef[]> {
    const paths = resultIds.map((resultId) => this.resolve(sender, resultId));
    const scope = await resolveSearchScope(this.home, this.platform);
    const files: AttachableFile[] = [];
    for (const filePath of paths) {
      const file = await readAttachable(filePath);
      if (searchableLocation(scope, file.realPath) === null)
        throw new Error(`${file.name} is outside the searchable folders. Browse for it instead.`);
      files.push(file);
    }
    const http = this.connection.http();
    if (!http) throw notConnected();
    return uploadAttachables(http, files);
  }

  private issue(sender: number, filePath: string): string {
    const now = this.now();
    // Every id shares one lifetime, so insertion order is also expiry order.
    for (const [resultId, entry] of this.issued) {
      if (entry.expiresAt > now && this.issued.size < MAX_RESULT_IDS) break;
      this.issued.delete(resultId);
    }
    const resultId = randomUUID();
    this.issued.set(resultId, { path: filePath, sender, expiresAt: now + RESULT_TTL_MS });
    return resultId;
  }

  private resolve(sender: number, resultId: string): string {
    const entry = this.issued.get(resultId);
    // Another sender's id reads as unknown, so ids cannot be probed across windows.
    if (!entry || entry.sender !== sender)
      throw new Error('This search result is no longer available. Search again.');
    if (entry.expiresAt <= this.now()) {
      this.issued.delete(resultId);
      throw new Error('This search result expired. Search again.');
    }
    return entry.path;
  }
}

/** Renderer-safe metadata: a name and a location, never the path. */
function resultFields({
  hit,
  name,
  location,
  extension,
}: Candidate): Omit<FileSearchResult, 'resultId'> {
  const oversized = tooLarge(hit);
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
  };
}
