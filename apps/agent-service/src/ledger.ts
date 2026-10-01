import { readFile, stat } from 'node:fs/promises';
import { Compile } from 'typebox/compile';
import {
  AgentTaskSchema,
  LedgerDataSchema,
  type AgentTask,
  type LedgerData,
  type TaskRun,
} from '@ai/agent-contracts';
import { atomicWrite } from './config.js';
import type { ServicePaths } from './storage.js';

/**
 * Every change validates the whole ledger, which grows with each task, so the schema is compiled
 * once (tens of times faster than `Value.Check`). Compiling evaluates generated code, which only
 * the service may do: the renderer's CSP forbids it, so the shared contracts stay uncompiled.
 */
const LedgerValidator = Compile(LedgerDataSchema);

/** The contracts' `parse` over the compiled validator, with the same error message. */
function parseLedger(value: unknown): LedgerData {
  if (LedgerValidator.Check(value)) return value;
  const issue = LedgerValidator.Errors(value)[0];
  throw new TypeError(`Invalid data${issue ? `: ${issue.instancePath} ${issue.message}` : '.'}`);
}

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
  private readonly listeners = new Set<() => void>();
  private constructor(
    private readonly file: string,
    public data: LedgerData,
  ) {}

  static async load(paths: ServicePaths): Promise<Ledger> {
    const file = paths.ledgerFile;
    try {
      if ((await stat(file)).size > 64 * 1024 * 1024) throw new Error('Task ledger is too large.');
      const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
      return new Ledger(file, parseLedger(dropRetiredData(raw)));
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
      await atomicWrite(this.file, parseLedger(draft));
      this.data = draft;
      this.notify();
      return result;
    });
    this.chain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  /** Runs `listener` after each change lands, with `data` already updated; failures are isolated. */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A broken listener must not fail the change that already landed.
      }
    }
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

/** Task fields the current contract knows; any other top-level task field is retired. */
const TASK_KEYS: ReadonlySet<string> = new Set(Object.keys(AgentTaskSchema.properties));
/** Kinds of pending requests whose feature was removed (the planning approval). */
const RETIRED_REQUEST_KINDS: ReadonlySet<unknown> = new Set(['plan']);

/**
 * Read-side tolerance for a ledger written by a build with since-removed features: a retired
 * top-level task field (the planning flag) and pending requests of a retired kind would make
 * the strict parse refuse the whole ledger. Both are dropped before it; recovery then ends a run
 * that waited on a dropped request. Anything else is left for the parse to judge, and writes
 * stay strict.
 */
function dropRetiredData(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const { tasks, pendingConfirms } = raw;
  return {
    ...raw,
    tasks: Array.isArray(tasks)
      ? tasks.map((task: unknown) =>
          isRecord(task)
            ? Object.fromEntries(Object.entries(task).filter(([key]) => TASK_KEYS.has(key)))
            : task,
        )
      : tasks,
    pendingConfirms: Array.isArray(pendingConfirms)
      ? pendingConfirms.filter(
          (request: unknown) => !isRecord(request) || !RETIRED_REQUEST_KINDS.has(request.kind),
        )
      : pendingConfirms,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
