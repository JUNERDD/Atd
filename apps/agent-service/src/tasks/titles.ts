import { errorMessage, type TaskRun } from '@atd/agent-contracts';
import type { Ledger } from '../ledger.js';
import type { Logger } from '../logging.js';
import type { ServicePaths } from '../storage.js';

interface TitleDeps {
  ledger: Ledger;
  paths: ServicePaths;
  log: Logger;
  enabled: () => boolean;
  notify: (taskId: string) => void;
}

/** The whole background job, including opening the model, must settle its pending title. */
const TITLE_TIMEOUT_MS = 30_000;

/**
 * One title request per newly accepted conversation. It owns no session or transcript and never
 * blocks its run. The persisted pending marker is also the right to replace the fallback title:
 * a rename, deletion or recovery removes that right before a late answer can be committed.
 */
export class TaskTitles {
  private readonly jobs = new Map<string, { abort: AbortController; done: Promise<void> }>();
  private stopped = false;

  constructor(private readonly deps: TitleDeps) {}

  enabled(): boolean {
    return !this.stopped && this.deps.enabled();
  }

  start(taskId: string, run: TaskRun): void {
    if (
      this.stopped ||
      this.jobs.has(taskId) ||
      this.deps.ledger.task(taskId).titleGeneration !== 'pending'
    )
      return;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TITLE_TIMEOUT_MS);
    const done = this.generate(taskId, run, abort.signal)
      .catch((error: unknown) => {
        this.deps.log.warn('A conversation title could not be saved.', {
          taskId,
          error: errorMessage(error),
        });
      })
      .finally(() => {
        clearTimeout(timer);
        this.jobs.delete(taskId);
      });
    this.jobs.set(taskId, { abort, done });
  }

  cancel(taskId: string): void {
    this.jobs.get(taskId)?.abort.abort();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const job of this.jobs.values()) job.abort.abort();
    await Promise.all([...this.jobs.values()].map((job) => job.done));
  }

  private async generate(taskId: string, run: TaskRun, signal: AbortSignal): Promise<void> {
    let title: string | undefined;
    let aborted: (() => void) | undefined;
    try {
      // Race the entire job: a provider or credential lookup that ignores cancellation cannot
      // leave the skeleton visible or hold service shutdown past the title's deadline.
      const cancelled = new Promise<never>((_, reject) => {
        aborted = () => reject(new Error('Title generation cancelled.'));
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
      });
      const completion = import('./title-model.js').then(({ generateTitle }) =>
        generateTitle(this.deps.paths, run, signal),
      );
      title = await Promise.race([completion, cancelled]);
    } catch (error) {
      if (!signal.aborted)
        this.deps.log.debug('A conversation title kept its initial text.', {
          taskId,
          error: errorMessage(error),
        });
    } finally {
      if (aborted) signal.removeEventListener('abort', aborted);
    }
    await this.settle(taskId, signal.aborted ? undefined : title);
  }

  private async settle(taskId: string, title: string | undefined): Promise<void> {
    if (!this.deps.ledger.data.tasks.some((task) => task.id === taskId && task.titleGeneration))
      return;
    const changed = await this.deps.ledger.change((data) => {
      const task = data.tasks.find((item) => item.id === taskId);
      if (!task || task.titleGeneration !== 'pending') return false;
      if (title) task.title = title;
      delete task.titleGeneration;
      // Naming is metadata: keep the conversation's last activity time and list position.
      return true;
    });
    if (changed) this.deps.notify(taskId);
  }
}
