import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  errorMessage,
  type AgentTask,
  type LedgerData,
  type StoredResource,
} from '@atd/agent-contracts';
import type { Ledger } from '../ledger.js';
import type { Logger } from '../logging.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How long a shared resource no run sends stays stored after it was last handed out: drafts the
 * page keeps in its own storage name resources the service cannot see, and a draft left this
 * long and then sent asks for its files again (resources/stored.ts `ResourceGone`).
 */
export const RESOURCE_GRACE_MS = 14 * DAY_MS;
/** The first sweep waits until the recovered runs were dispatched; then one runs each day. */
const FIRST_SWEEP_DELAY_MS = 30_000;
/** A resource file's name: its id (`Identifier`); nothing else in the folder is a resource. */
const RESOURCE_FILE = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Where resources are referenced, which garbage collection never removes:
 * - every run of every task names the files it sends (`input.files`); a fork carries copies of
 *   its source's runs (tasks/fork.ts), and a file chip or a command's `{{files}}` text never names
 *   a file its run's `files` lacks;
 * - a task-scoped resource (codemode output, MCP results, computer screenshots and downloads) is
 *   named by its task's transcript and by the transcripts of the task's forks;
 * - drafts and the page's open views, invisible to the service, which the grace period covers.
 */
export function attachedIds(tasks: readonly AgentTask[]): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks)
    for (const run of task.runs) for (const file of run.snapshot.input.files) ids.add(file.id);
  return ids;
}

/**
 * Inside the ledger change that deletes `removed`, once it left `draft.tasks`: hands the
 * resources it used to the sweep (`sweepResources`) as of `at`, the deletion time, instead of
 * removing them now. A draft of another conversation may hold one where the service cannot see
 * it: the same file attached there and reused by dedupe, a "Recently attached" pick, an artifact
 * attached from this task. Counting the grace period from the deletion keeps such a draft
 * sendable, and the sweep still removes the copies no run sends. What another conversation
 * references already keeps its place:
 * - a task-scoped resource another task's run sends becomes shared, readable there from now on;
 * - one a fork of the task may name (a task sharing a run with it, created after the resource)
 *   moves to that fork;
 * - any other task-scoped resource of the task becomes shared too, so a draft that sends it can
 *   read it, and the sweep can remove it.
 */
export function releaseTaskResources(draft: LedgerData, removed: AgentTask, at: string): void {
  const attached = attachedIds(draft.tasks);
  const sent = new Set(removed.runs.flatMap((run) => run.snapshot.input.files.map(({ id }) => id)));
  const runIds = new Set(removed.runs.map((run) => run.id));
  const forks = draft.tasks.filter((task) => task.runs.some((run) => runIds.has(run.id)));
  for (const row of draft.resources) {
    const owned = row.taskId === removed.id;
    if (!owned && !sent.has(row.id)) continue;
    if (owned && !attached.has(row.id)) {
      const created = Date.parse(row.createdAt);
      const heir = forks.find((task) => Date.parse(task.createdAt) >= created);
      if (heir) {
        row.taskId = heir.id;
        continue;
      }
    }
    if (owned) row.taskId = null;
    if (!attached.has(row.id) && row.taskId === null) row.touchedAt = at;
  }
}

/**
 * Removes what no conversation references any longer, as of `now`: shared resources that no run
 * sends and that nothing handed out within the grace period, and files in `dir` that no ledger
 * row names (left by an interrupted write or removal) and that are older than it. A task-scoped
 * resource whose task is gone stays: a fork made before this collection existed may name it.
 * Returns how many files went.
 */
export async function sweepResources(ledger: Ledger, dir: string, now: number): Promise<number> {
  const cutoff = now - RESOURCE_GRACE_MS;
  const expired = (data: LedgerData) => {
    const attached = attachedIds(data.tasks);
    return data.resources.filter(
      (row) => row.taskId === null && !attached.has(row.id) && handedOutAt(row) < cutoff,
    );
  };
  // Decided again inside the change: a run accepted meanwhile may send one of them.
  const removed = expired(ledger.data).length
    ? await ledger.change((draft) => {
        const ids = new Set(expired(draft).map((row) => row.id));
        draft.resources = draft.resources.filter((row) => !ids.has(row.id));
        return [...ids];
      })
    : [];
  const known = new Set(ledger.data.resources.map((row) => row.id));
  const strays = await unnamedFiles(dir, known, cutoff);
  const files = [...new Set([...removed, ...strays])];
  await removeResourceFiles(dir, files);
  return files.length;
}

/** Removes the files of resources the ledger no longer names. */
export async function removeResourceFiles(dir: string, ids: readonly string[]): Promise<void> {
  await Promise.allSettled(ids.map((id) => rm(path.join(dir, id), { force: true })));
}

export interface ResourceSweepDeps {
  ledger: Ledger;
  /** The resource store's folder (`ServicePaths.resourcesDir`). */
  dir: string;
  log: Logger;
}

/**
 * Sweeps `dir` (`sweepResources`) once the server listens, and then daily, one sweep at a time;
 * closing the server stops the schedule and waits for a sweep under way.
 */
export function scheduleResourceSweeps(app: FastifyInstance, deps: ResourceSweepDeps): void {
  let running: Promise<void> = Promise.resolve();
  const timers: NodeJS.Timeout[] = [];
  const sweep = () => {
    running = running
      .then(() => sweepResources(deps.ledger, deps.dir, Date.now()))
      .then(
        (count) => {
          if (count) deps.log.info('Removed resources no conversation references.', { count });
        },
        (error: unknown) =>
          deps.log.warn('Unreferenced resources were not removed; the next sweep retries.', {
            error: errorMessage(error),
          }),
      );
  };
  app.addHook('onListen', () => {
    timers.push(setTimeout(sweep, FIRST_SWEEP_DELAY_MS).unref());
    timers.push(setInterval(sweep, DAY_MS).unref());
  });
  app.addHook('onClose', async () => {
    for (const timer of timers) clearTimeout(timer);
    await running;
  });
}

/** When a resource was last handed out: its newest import, else its creation. */
function handedOutAt(row: StoredResource): number {
  return Date.parse(row.touchedAt ?? row.createdAt);
}

/** Resource files in `dir` that `known` does not name, last written before `cutoff`. */
async function unnamedFiles(dir: string, known: ReadonlySet<string>, cutoff: number) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const strays: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !RESOURCE_FILE.test(entry.name) || known.has(entry.name)) continue;
    const info = await stat(path.join(dir, entry.name)).catch(() => null);
    if (info && info.mtimeMs < cutoff) strays.push(entry.name);
  }
  return strays;
}
