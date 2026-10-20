import type { Page } from 'playwright-core';
import { untilCancelled, WorkerError, type Operation } from './operations.js';
import type { Pages } from './pages.js';

/**
 * `page_focus`: what the person has in front of them, for the host's `targetInUse` check. The
 * host asks only while the managed browser is the frontmost app, for the target's bound page and
 * the popups it admitted, and yields when any of them is the tab the person is looking at.
 *
 * The pages answer for themselves. Playwright keeps focus emulation on for every page it drives
 * (its default, which the worker keeps), so `document.hasFocus()` is true for all of them
 * whatever the person has focused, and cannot by itself tell a tab the person uses from one the
 * agent works in. The tab's visibility is not emulated: `document.visibilityState` is `visible`
 * only for the tab a window shows (and not for a minimized window), so the host requires both.
 *
 * It only reads. It never focuses a page, calls `bringToFront` or activates a target: nothing the
 * worker does may change which tab, window or app the person sees.
 */

/** What all the named pages together have to answer within. */
const BUDGET_MS = 2_000;
const STATE_EXPRESSION =
  "({ hasFocus: document.hasFocus(), visible: document.visibilityState === 'visible' })";

interface PageState {
  pageId: string;
  hasFocus: boolean;
  visible: boolean;
}

/** One page's state, or `timeout` when it does not answer within `budgetMs`. */
async function stateOf(
  op: Operation,
  pageId: string,
  page: Page,
  budgetMs: number,
): Promise<PageState> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new WorkerError('timeout', 'A page did not report its focus in time.')),
      budgetMs,
    );
  });
  try {
    const raw: unknown = await untilCancelled(
      op,
      Promise.race([page.evaluate(STATE_EXPRESSION), expired]),
    );
    const fields = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const { hasFocus, visible } = fields;
    if (typeof hasFocus !== 'boolean' || typeof visible !== 'boolean')
      throw new WorkerError('engineFailed', 'The page did not report its focus.');
    return { pageId, hasFocus, visible };
  } finally {
    clearTimeout(timer);
  }
}

export async function pageFocus(
  pages: Pages,
  op: Operation,
  input: { pageIds: readonly string[] },
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + BUDGET_MS;
  const focus: PageState[] = [];
  for (const pageId of new Set(input.pageIds)) {
    try {
      focus.push(
        await pages.withPage(op, pageId, (page) =>
          stateOf(op, pageId, page, Math.max(1, deadline - Date.now())),
        ),
      );
    } catch (error) {
      // A page that closed since the host listed it is not one the person is using.
      if (!(error instanceof WorkerError) || error.code !== 'notFound') throw error;
    }
  }
  return { focus };
}
