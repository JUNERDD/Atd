import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { TaskSearchHit, TaskSearchQuery, TaskSearchResponse } from '@atd/agent-contracts';
import type { Ledger } from '../ledger.js';
import type { LiveState } from '../live-state.js';
import type { Logger } from '../logging.js';
import { matchTask, queryTerms } from './search-match.js';
import { TaskSearchText } from './search-text.js';

/** Tasks returned when the query sets no limit (TaskSearchQuerySchema). */
const DEFAULT_LIMIT = 100;
/** Tasks matched between yields, so a search over cached text never holds the loop for long. */
const YIELD_EVERY = 64;

export interface TaskSearchDeps {
  ledger: Ledger;
  log: Pick<Logger, 'warn'>;
  /** The task's live session state, when a runner holds one. */
  live: (taskId: string) => LiveState | null;
}

/**
 * History search (`GET /v1/tasks/search`) over every task in the ledger, side chats included.
 * Tasks are visited most recently updated first and the search stops once one more than `limit`
 * matched, so older sessions are read only when the newer ones do not fill the page.
 */
export class TaskSearch {
  private readonly text: TaskSearchText;

  constructor(private readonly deps: TaskSearchDeps) {
    this.text = new TaskSearchText(deps.log);
  }

  async search(query: TaskSearchQuery): Promise<TaskSearchResponse> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const terms = queryTerms(query.query);
    const tasks = this.deps.ledger.data.tasks;
    this.text.retain(new Set(tasks.map((task) => task.id)));
    if (!terms.length) return { hits: [], truncated: false };
    const ordered = tasks
      .map((task) => ({ task, at: Date.parse(task.updatedAt) || 0 }))
      .sort((a, b) => b.at - a.at)
      .map(({ task }) => task);
    const hits: TaskSearchHit[] = [];
    let visited = 0;
    for (const task of ordered) {
      const messages = await this.text.messages(task, this.deps.live(task.id));
      const hit = matchTask(task.id, messages, terms);
      if (hit) {
        if (hits.length === limit) return { hits, truncated: true };
        hits.push(hit);
      }
      visited += 1;
      if (visited % YIELD_EVERY === 0) await yieldToEventLoop();
    }
    return { hits, truncated: false };
  }
}
