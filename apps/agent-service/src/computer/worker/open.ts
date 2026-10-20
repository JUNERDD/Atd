import { errors, type Browser, type CDPSession, type Page } from 'playwright-core';
import {
  pause,
  throwIfCancelled,
  untilCancelled,
  WorkerError,
  type Operation,
} from './operations.js';
import type { WindowFrame } from './opening-schemas.js';
import type { Pages } from './pages.js';

/**
 * `open_page`: opens an http(s) page of an approved website in the managed browser without taking
 * the screen, which is how a run is given a website. CDP's `Target.createTarget` with
 * `background: true` creates the page without selecting it, focusing it or bringing a window
 * forward; the worker never calls `bringToFront` or `Target.activateTarget` and passes no `focus`,
 * so the app the person is in stays the active one.
 *
 * Normally the page is a background tab of a window the browser has. A browser without a window
 * (just started with no startup window, or its last window closed) cannot hold a tab, so with
 * `parkAt` the page opens in a new background window instead, and that window is moved to
 * `parkAt` at once. The system keeps part of a window on a display, so the frame the browser
 * reports afterwards is returned for the host to log.
 *
 * Playwright learns of the new target from the browser's own attach event; the call waits for that
 * and for the document to commit, so the page the host lists next is the page at its address and
 * not a blank one.
 */

/** How long the new page may take to be attached, then to commit its first document. */
const ATTACH_BUDGET_MS = 5_000;
const COMMIT_BUDGET_MS = 8_000;
const POLL_MS = 100;
/** How often the new target's window is asked for before the browser is called late. */
const WINDOW_ATTEMPTS = 5;

type Bounds = { left: number; top: number; width: number; height: number };

/** Whether the browser has a window, which any page it lists lives in. */
function hasWindow(browser: Browser): boolean {
  return browser.contexts().some((context) => context.pages().length > 0);
}

/** The id of the window that holds the new target; asked again briefly if the browser is late. */
async function windowOf(op: Operation, session: CDPSession, targetId: string): Promise<number> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { windowId } = await untilCancelled(
        op,
        session.send('Browser.getWindowForTarget', { targetId }),
      );
      return windowId;
    } catch (error) {
      if (attempt >= WINDOW_ATTEMPTS - 1 || op.signal.aborted) throw error;
    }
    await pause(op, POLL_MS);
  }
}

/** Moves the new target's window to `frame` and reads back where the browser put it. */
async function park(
  op: Operation,
  session: CDPSession,
  targetId: string,
  frame: WindowFrame,
): Promise<Bounds | undefined> {
  const windowId = await windowOf(op, session, targetId);
  await untilCancelled(op, session.send('Browser.setWindowBounds', { windowId, bounds: frame }));
  const { bounds } = await untilCancelled(
    op,
    session.send('Browser.getWindowBounds', { windowId }),
  );
  const { left, top, width, height } = bounds;
  return left === undefined || top === undefined || width === undefined || height === undefined
    ? undefined
    : { left, top, width, height };
}

/** Creates the page through a browser-level session, which is detached again at once. */
async function createBackgroundPage(
  op: Operation,
  browser: Browser,
  url: string,
  parkAt: WindowFrame | undefined,
): Promise<{ pageId: string; parked?: Bounds }> {
  const session = await untilCancelled(op, browser.newBrowserCDPSession());
  try {
    throwIfCancelled(op);
    // From here a page may exist whatever happens next.
    op.dispatched = true;
    const { targetId } = await untilCancelled(
      op,
      session.send(
        'Target.createTarget',
        parkAt === undefined
          ? { url, background: true }
          : { url, newWindow: true, background: true },
      ),
    );
    if (parkAt === undefined) return { pageId: targetId };
    // The page is still the page if the window cannot be moved; the host logs the missing frame.
    const parked = await park(op, session, targetId, parkAt).catch((error: unknown) => {
      if (op.signal.aborted) throw error;
      return undefined;
    });
    return parked === undefined ? { pageId: targetId } : { pageId: targetId, parked };
  } finally {
    await session.detach().catch(() => undefined);
  }
}

/** The page once Playwright has attached it; undefined when that takes longer than the budget. */
async function attached(pages: Pages, op: Operation, pageId: string): Promise<Page | undefined> {
  const deadline = Date.now() + ATTACH_BUDGET_MS;
  while (Date.now() < deadline) {
    try {
      return await pages.withPage(op, pageId, async (page) => page);
    } catch (error) {
      if (!(error instanceof WorkerError) || error.code !== 'notFound') throw error;
    }
    await pause(op, POLL_MS);
  }
  return undefined;
}

export async function openPage(
  pages: Pages,
  op: Operation,
  input: { url: string; allowedOrigins: readonly string[]; parkAt?: WindowFrame | undefined },
): Promise<Record<string, unknown>> {
  let target: URL;
  try {
    target = new URL(input.url);
  } catch {
    throw new WorkerError('unsupported', 'The URL is not valid.');
  }
  if (
    (target.protocol !== 'http:' && target.protocol !== 'https:') ||
    !input.allowedOrigins.includes(target.origin)
  )
    throw new WorkerError('unsupported', 'Only a page of the approved website can be opened.');
  const browser = await untilCancelled(op, pages.connect());
  if (input.parkAt === undefined && !hasWindow(browser))
    throw new WorkerError('unsupported', 'The browser has no window to hold a background tab.');
  const { pageId, parked } = await createBackgroundPage(op, browser, target.href, input.parkAt);
  const page = await attached(pages, op, pageId);
  if (page === undefined) return { pageId, url: '', ...(parked ? { parked } : {}) };
  const committed = page
    .waitForURL((url) => url.protocol === 'http:' || url.protocol === 'https:', {
      waitUntil: 'commit',
      timeout: COMMIT_BUDGET_MS,
    })
    .catch((error: unknown) => {
      // A page that is slow to commit is still the page; the host lists it when it has.
      if (!(error instanceof errors.TimeoutError)) throw error;
    });
  await untilCancelled(op, committed);
  return { pageId, url: page.url(), ...(parked ? { parked } : {}) };
}
