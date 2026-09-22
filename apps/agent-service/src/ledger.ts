import { readFile, stat } from 'node:fs/promises';
import {
  parse,
  LedgerDataSchema,
  type AgentTask,
  type LedgerData,
  type TaskRun,
} from '@ai/agent-contracts';
import { atomicWrite } from './config.js';
import type { ServicePaths } from './storage.js';

function emptyLedger(): LedgerData {
  return {
    version: 1,
    tasks: [],
    operations: {},
    resources: [],
    pendingConfirms: [],
    pendingCapabilities: [],
  };
}

/**
 * Service-owned task ledger: runs, parent-child refs and the operationId
 * idempotency index. Pi JSONL stays the transcript source; the ledger never
 * duplicates message history.
 */
export class Ledger {
  private chain: Promise<void> = Promise.resolve();
  private constructor(
    private readonly file: string,
    public data: LedgerData,
  ) {}

  static async load(paths: ServicePaths): Promise<Ledger> {
    const file = paths.ledgerFile;
    try {
      if ((await stat(file)).size > 64 * 1024 * 1024) throw new Error('Task ledger is too large.');
      return new Ledger(file, parse(LedgerDataSchema, JSON.parse(await readFile(file, 'utf8'))));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        const ledger = new Ledger(file, emptyLedger());
        await atomicWrite(file, ledger.data);
        return ledger;
      }
      throw new Error('Saved task ledger could not be read. The original file is preserved.');
    }
  }

  /** Serializes mutations; publishes only after the atomic write lands. */
  change<T>(update: (draft: LedgerData) => T | Promise<T>): Promise<T> {
    const operation = this.chain.then(async () => {
      const draft = structuredClone(this.data);
      const result = await update(draft);
      await atomicWrite(this.file, parse(LedgerDataSchema, draft));
      this.data = draft;
      return result;
    });
    this.chain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  task(taskId: string): AgentTask {
    const task = this.data.tasks.find((item) => item.id === taskId);
    if (!task) throw notFound('Task', taskId);
    return task;
  }

  run(taskId: string, runId: string): TaskRun {
    const run = this.task(taskId).runs.find((item) => item.id === runId);
    if (!run) throw notFound('Run', runId);
    return run;
  }

  operation(operationId: string): { taskId: string; runId: string } | undefined {
    return this.data.operations[operationId];
  }
}

/** Typed not-found failure mapped to HTTP 404 by the server layer. */
export class LedgerNotFound extends Error {
  constructor(
    readonly kind: string,
    readonly id: string,
  ) {
    super(`${kind} ${id} was not found.`);
    this.name = 'LedgerNotFound';
  }
}

function notFound(kind: string, id: string): LedgerNotFound {
  return new LedgerNotFound(kind, id);
}
