import { errors, type Locator, type Page } from 'playwright-core';
import {
  pause,
  throwIfCancelled,
  untilCancelled,
  WorkerError,
  type Operation,
} from './operations.js';
import {
  locatorFor,
  READ_TIMEOUT_MS,
  type Element,
  type Origins,
  type PageRead,
  type Pages,
} from './pages.js';
import { PRESS_ROLES, TEXT_ROLES, truncate, visibleValue } from './text.js';
import { fillWithFeedback, type TypingFeedback } from './typing.js';

/**
 * The page-changing tools on Playwright locators. Each checks everything it can before it sets
 * `op.dispatched` and sends the first command, and never retries a command once sent: a failure
 * after the flip is reported with `dispatched: true` (unknown outcome). `press` runs Playwright's
 * actionability checks as a `trial` before the flip, so waiting for an overlay or a delayed
 * element is never reported as a dispatch.
 */

/** How long a filled field must keep its value before `fill` calls it verified. */
const FILL_SETTLE_MS = 100;
/** Pixels one scroll `amount` unit moves. */
const SCROLL_STEP_PX = 100;
const SCROLL_POSITION_EXPRESSION = '[Math.round(scrollX), Math.round(scrollY)]';
/** Actionability budget of one action. */
const ACTION_TIMEOUT_MS = 5_000;
/** How long `navigate` waits for `load` before it moves on. */
const NAVIGATE_LOAD_MS = 10_000;

export type Evidence = { kind: 'value' | 'text' | 'url'; summary: string };

/** The DOM members the field functions read; they run in the page (no DOM types in Node). */
interface FieldNode {
  readonly tagName: string;
  readonly isContentEditable: boolean;
  readonly readOnly?: boolean;
  readonly value?: string;
  readonly innerText: string;
  readonly ownerDocument: { readonly activeElement: unknown };
  contains(other: unknown): boolean;
  scrollBy(x: number, y: number): void;
}

/** Maps Playwright's own errors to closed codes; a WorkerError passes through. */
export async function pw<T>(op: Operation, promise: Promise<T>): Promise<T> {
  try {
    return await untilCancelled(op, promise);
  } catch (error) {
    if (error instanceof WorkerError) throw error;
    if (op.signal.aborted) throw new WorkerError('cancelled', 'The operation was cancelled.');
    if (error instanceof errors.TimeoutError)
      throw new WorkerError('timeout', truncate(error.message.split('\n')[0] ?? '', 500));
    throw error;
  }
}

/** The actionability budget and cancellation of one Playwright call. */
export function actionOptions(op: Operation): { timeout: number; signal: AbortSignal } {
  return { timeout: ACTION_TIMEOUT_MS, signal: op.signal };
}

/** Reads the page and refuses a stale observation or a ref outside it, before any dispatch. */
export async function readCurrent(
  pages: Pages,
  op: Operation,
  input: { pageId: string; observationVersion: number; ref: string; allowedOrigins?: Origins },
  page: Page,
): Promise<{ read: PageRead; element: Element }> {
  const read = await pages.read(op, input.pageId, page, input.allowedOrigins);
  if (read.observationVersion !== input.observationVersion)
    throw new WorkerError(
      'staleObservation',
      `The page changed since observation ${String(input.observationVersion)} (now ${String(read.observationVersion)}); observe again.`,
    );
  return { read, element: pages.element(read, input.ref, input.allowedOrigins) };
}

/** Like `readCurrent` for an optional ref; without one it only reads the document. */
export async function readOptional(
  pages: Pages,
  op: Operation,
  input: { pageId: string; observationVersion?: number | undefined; ref?: string | undefined },
  origins: Origins,
  page: Page,
): Promise<Element | undefined> {
  const { ref, observationVersion, pageId } = input;
  if (ref === undefined) {
    await pages.readDocument(op, pageId, page);
    return undefined;
  }
  if (observationVersion === undefined)
    throw new WorkerError('staleObservation', 'A ref needs the observation it came from.');
  const current = { pageId, observationVersion, ref, allowedOrigins: origins };
  return (await readCurrent(pages, op, current, page)).element;
}

/** Best-effort read after a dispatch: a failure here never hides that the command was sent. */
export async function settleRead(
  pages: Pages,
  op: Operation,
  pageId: string,
  page: Page,
  origins: Origins,
): Promise<void> {
  if (op.signal.aborted) return;
  await pages.read(op, pageId, page, origins).catch(() => undefined);
}

/**
 * Runs a fixed function on the element in the page. It is serialized, so it may use only its
 * node, never values of this module.
 */
function evaluateField<R>(op: Operation, locator: Locator, read: (node: FieldNode) => R) {
  return pw(op, locator.evaluate(read, undefined, { timeout: READ_TIMEOUT_MS }));
}

/**
 * `fill`: replaces a text field's value (input, textarea or content-editable) with `text`, or
 * empties it when `text` is empty (the `clear` step), then checks it still holds the text and
 * keeps focus.
 */
export async function fill(
  pages: Pages,
  op: Operation,
  input: { pageId: string; ref: string; text: string; observationVersion: number } & {
    allowedOrigins?: Origins;
    feedback?: TypingFeedback | undefined;
  },
): Promise<Record<string, unknown>> {
  return pages.withPage(op, input.pageId, async (page) => {
    const { element } = await readCurrent(pages, op, input, page);
    if (!TEXT_ROLES.has(element.role))
      throw new WorkerError('unsupported', `A ${element.role} is not a text field.`);
    if (element.disabled) throw new WorkerError('unsupported', 'The field is disabled.');
    const locator = locatorFor(element);
    const info = await evaluateField(op, locator, (node) => ({
      tag: node.tagName,
      editable: node.isContentEditable,
      readOnly: node.readOnly === true,
    }));
    if (!info.editable && info.tag !== 'INPUT' && info.tag !== 'TEXTAREA')
      throw new WorkerError('unsupported', 'Not a text field.');
    if (info.readOnly) throw new WorkerError('unsupported', 'The field is read-only.');
    if (input.text.includes('\n') && info.tag === 'INPUT')
      throw new WorkerError('unsupported', 'A single-line field cannot take multi-line text.');
    throwIfCancelled(op);
    await pw(op, fillWithFeedback(page, op, locator, input.text, input.feedback));
    await pause(op, FILL_SETTLE_MS);
    const after = await evaluateField(op, locator, (node) => ({
      value: node.isContentEditable ? node.innerText.replace(/\n$/, '') : (node.value ?? ''),
      focused:
        node === node.ownerDocument.activeElement ||
        node.contains(node.ownerDocument.activeElement),
    }));
    if (!after.focused)
      throw new WorkerError('targetChanged', 'The field lost focus after typing.');
    if (after.value !== input.text)
      throw new WorkerError(
        'engineFailed',
        `The field holds ${String(after.value.length)} characters that differ from the text after typing.`,
      );
    const label = element.name || element.role;
    const evidence: Evidence[] = [
      { kind: 'value', summary: `${label}: ${visibleValue(element.name, after.value, 400)}` },
    ];
    return { verified: true, evidence };
  });
}

/** `press`: a trusted click on an enabled element, after a trial that sends no input. */
export async function press(
  pages: Pages,
  op: Operation,
  input: { pageId: string; ref: string; observationVersion: number; allowedOrigins?: Origins },
): Promise<Record<string, unknown>> {
  return pages.withPage(op, input.pageId, async (page) => {
    const { element } = await readCurrent(pages, op, input, page);
    if (!PRESS_ROLES.has(element.role))
      throw new WorkerError('unsupported', `A ${element.role} cannot be pressed.`);
    if (element.disabled) throw new WorkerError('unsupported', 'The element is disabled.');
    const baselineId = await pages.captureBaseline(op, input.pageId, page);
    const locator = locatorFor(element);
    // Actionability only (visible, stable, enabled, receives events); sends no input.
    await pw(op, locator.click({ ...actionOptions(op), trial: true }));
    throwIfCancelled(op);
    op.dispatched = true;
    await pw(op, locator.click(actionOptions(op)));
    await settleRead(pages, op, input.pageId, page, input.allowedOrigins);
    return { baselineId };
  });
}

/** `scroll`: the window, or an element of the observation, by `amount` × 100 px. */
export async function scroll(
  pages: Pages,
  op: Operation,
  input: {
    pageId: string;
    ref?: string | undefined;
    observationVersion?: number | undefined;
    direction: 'up' | 'down' | 'left' | 'right';
    amount: number;
    allowedOrigins?: Origins;
  },
): Promise<Record<string, unknown>> {
  return pages.withPage(op, input.pageId, async (page) => {
    const element = await readOptional(pages, op, input, input.allowedOrigins, page);
    throwIfCancelled(op);
    const delta = input.amount * SCROLL_STEP_PX;
    const sign = input.direction === 'down' || input.direction === 'right' ? 1 : -1;
    const vertical = input.direction === 'up' || input.direction === 'down';
    const [dx, dy] = vertical ? [0, sign * delta] : [sign * delta, 0];
    op.dispatched = true;
    if (element === undefined)
      await pw(op, page.evaluate(`window.scrollBy(${String(dx)}, ${String(dy)})`));
    else {
      const locator = locatorFor(element);
      await pw(op, locator.scrollIntoViewIfNeeded(actionOptions(op)));
      const by = { x: dx, y: dy };
      const scroller = (node: FieldNode, arg: typeof by) => node.scrollBy(arg.x, arg.y);
      const scrolling = locator.evaluate(scroller, by, { timeout: READ_TIMEOUT_MS });
      await pw(op, scrolling);
    }
    const position: unknown = await page.evaluate(SCROLL_POSITION_EXPRESSION).catch(() => null);
    await settleRead(pages, op, input.pageId, page, input.allowedOrigins);
    return Array.isArray(position)
      ? { evidence: [{ kind: 'text', summary: `window scroll position ${position.join(', ')}` }] }
      : {};
  });
}

/** `navigate`: opens an http(s) URL (the host checked its origin), waiting for load at most 10 s. */
export async function navigate(
  pages: Pages,
  op: Operation,
  input: { pageId: string; url: string; allowedOrigins?: Origins },
): Promise<Record<string, unknown>> {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new WorkerError('unsupported', 'The URL is not valid.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new WorkerError('unsupported', 'Only http and https URLs can be opened.');
  return pages.withPage(op, input.pageId, async (page) => {
    await pages.readDocument(op, input.pageId, page);
    throwIfCancelled(op);
    op.dispatched = true;
    const loading = page
      .goto(parsed.href, { waitUntil: 'load', timeout: NAVIGATE_LOAD_MS, signal: op.signal })
      .catch((error: unknown) => {
        if (!(error instanceof errors.TimeoutError)) throw error;
        return null;
      });
    await untilCancelled(op, loading);
    const document = await pages.readDocument(op, input.pageId, page);
    await settleRead(pages, op, input.pageId, page, input.allowedOrigins);
    return { url: document.url, evidence: [{ kind: 'url', summary: truncate(document.url, 500) }] };
  });
}
