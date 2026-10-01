import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { errorMessage, parse } from '@ai/agent-contracts';
import { atomicWrite } from '../config.js';
import type { Logger } from '../logging.js';
import type { McpCatalogCounts } from './types.js';

/**
 * The last known tool, resource and prompt counts of each MCP server, kept in
 * `<dataDir>/mcp/catalog-counts.json` so a status row keeps offering "N tools…" while the server
 * has no open connection: before its first connect after a restart, after an idle close, after a
 * disconnect. The counts belong to the configuration they were measured under (its `reuseKey`),
 * so an edited server shows zeros until it connects again. Nothing here is secret: a server id, a
 * key and three numbers. A file that cannot be read starts the memory empty; status never fails
 * because of it.
 */

const CountSchema = Type.Integer({ minimum: 0 });

const FileSchema = Type.Object(
  {
    version: Type.Literal(1),
    servers: Type.Record(
      Type.String(),
      Type.Object(
        { key: Type.String(), tools: CountSchema, resources: CountSchema, prompts: CountSchema },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
type Entries = Static<typeof FileSchema>['servers'];

/** What connections use of the memory: recall counts, note them, and wait for the file. */
export type CountMemory = Pick<CatalogMemory, 'recall' | 'remember' | 'flush'>;

export function catalogCountsFile(dataDir: string): string {
  return path.join(dataDir, 'mcp', 'catalog-counts.json');
}

export class CatalogMemory {
  private queue: Promise<void> = Promise.resolve();
  private unsaved = false;

  private constructor(
    private readonly file: string,
    private readonly entries: Map<string, Entries[string]>,
    private readonly log: Logger,
  ) {}

  /** Reads the file; a missing, unreadable or malformed one (logged) leaves the memory empty. */
  static async load(dataDir: string, log: Logger): Promise<CatalogMemory> {
    const file = catalogCountsFile(dataDir);
    try {
      const saved = parse(FileSchema, JSON.parse(await readFile(file, 'utf8')));
      return new CatalogMemory(file, new Map(Object.entries(saved.servers)), log);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        log.warn('MCP catalog counts could not be read; last-known counts start empty.', {
          error: errorMessage(error),
        });
      }
      return new CatalogMemory(file, new Map(), log);
    }
  }

  /** What `serverId` offered when it last connected under `key`; undefined for any other key. */
  recall(serverId: string, key: string): McpCatalogCounts | undefined {
    const entry = this.entries.get(serverId);
    if (entry?.key !== key) return undefined;
    return { tools: entry.tools, resources: entry.resources, prompts: entry.prompts };
  }

  /** Notes what `serverId` offers under `key`; the file is written only when that is news. */
  remember(serverId: string, key: string, counts: McpCatalogCounts): void {
    const entry = this.entries.get(serverId);
    const same =
      entry?.key === key &&
      entry.tools === counts.tools &&
      entry.resources === counts.resources &&
      entry.prompts === counts.prompts;
    if (same) return;
    this.entries.set(serverId, { key, ...counts });
    this.save();
  }

  /** Drops a server that is gone. */
  forget(serverId: string): void {
    if (this.entries.delete(serverId)) this.save();
  }

  /** Drops every server not in `serverIds`, such as one removed while the service was off. */
  retain(serverIds: Iterable<string>): void {
    const keep = new Set(serverIds);
    let dropped = false;
    for (const serverId of [...this.entries.keys()]) {
      if (keep.has(serverId)) continue;
      this.entries.delete(serverId);
      dropped = true;
    }
    if (dropped) this.save();
  }

  /** Resolves once every change made so far is on disk (or its failure logged). */
  flush(): Promise<void> {
    return this.queue;
  }

  /** Writes the whole memory after the writes before it; changes made meanwhile share one write. */
  private save(): void {
    this.unsaved = true;
    this.queue = this.queue.then(async () => {
      if (!this.unsaved) return;
      this.unsaved = false;
      try {
        await atomicWrite(this.file, { version: 1, servers: Object.fromEntries(this.entries) });
      } catch (error) {
        this.log.warn('MCP catalog counts could not be saved.', { error: errorMessage(error) });
      }
    });
  }
}
