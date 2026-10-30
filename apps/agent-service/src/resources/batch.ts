import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { LedgerData, ResourceRef, ResourceSource, StoredResource } from '@atd/agent-contracts';
import type { Ledger } from '../ledger.js';
import { ResourceGone, toRef } from './stored.js';

/**
 * Resources stored together and recorded in one ledger change (`ResourceStore.save` with a
 * batch): the files the batch wrote, which no row names until it is recorded, and the stored
 * resources it reuses instead of a copy, which it hands out anew. A batch belongs to the store
 * that first stages a resource in it, and is used once: recorded (`commit`, or `apply` inside a
 * change of the caller's) or discarded.
 */
export class ResourceBatch {
  private readonly written: StoredResource[] = [];
  private readonly reused = new Map<string, { row: StoredResource; source?: ResourceSource }>();
  private store: { ledger: Ledger; dir: string } | undefined;

  /** Binds the batch to the store staging a resource in it (`ResourceStore.save`). */
  claim(ledger: Ledger, dir: string): void {
    if (this.store && this.store.ledger !== ledger)
      throw new Error('A resource batch belongs to one store.');
    this.store ??= { ledger, dir };
  }

  /** What the batch staged so far, newest last, which a later file of the batch may reuse. */
  rows(): StoredResource[] {
    return [...this.written, ...[...this.reused.values()].map(({ row }) => row)];
  }

  /** Stages a resource whose file the store just wrote. */
  add(row: StoredResource): ResourceRef {
    this.written.push(row);
    return toRef(row);
  }

  /**
   * Stages the reuse of a stored resource, read again from `source` when given: the resource
   * records that source, so a run sent later follows that file. A resource this batch wrote
   * itself adopts a source it lacks.
   */
  reuse(row: StoredResource, source?: ResourceSource): ResourceRef {
    if (this.written.includes(row)) {
      if (source && !row.source) row.source = source;
    } else {
      const staged = this.reused.get(row.id);
      const latest = source ?? staged?.source;
      this.reused.set(row.id, { row, ...(latest ? { source: latest } : {}) });
    }
    return toRef(row);
  }

  /**
   * Records the batch in `draft`, inside a ledger change: adds the rows it wrote and marks each
   * reused one handed out at `at`, with the source it was read from again. A reused resource that
   * left the ledger since the store found it refuses the change (`ResourceGone`): its file goes
   * with it, and nothing the batch wrote replaces it.
   */
  apply(draft: LedgerData, at: string): void {
    for (const { row, source } of this.reused.values()) {
      const current = draft.resources.find((item) => item.id === row.id);
      if (!current) throw new ResourceGone(row.name);
      current.touchedAt = at;
      if (source) current.source = source;
    }
    // Copies: the batch's own objects never become the ledger's published data.
    draft.resources.push(...this.written.map((row) => structuredClone(row)));
  }

  /** Records the batch in a ledger change of its own; when that fails, removes what it wrote. */
  async commit(): Promise<void> {
    const store = this.store;
    if (!store || (!this.written.length && !this.reused.size)) return;
    const at = new Date().toISOString();
    try {
      await store.ledger.change((draft) => this.apply(draft, at));
    } catch (error) {
      await this.discard();
      throw error;
    }
  }

  /**
   * Removes the files the batch wrote. No row names them, so a file that cannot be removed stays
   * behind unreferenced until the sweep collects it (gc.ts).
   */
  async discard(): Promise<void> {
    const store = this.store;
    if (!store) return;
    await Promise.allSettled(
      this.written.map(({ id }) => rm(path.join(store.dir, id), { force: true })),
    );
  }
}
