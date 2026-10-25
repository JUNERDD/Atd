import { clearTypingFeedback } from './typing.js';
import type { Page } from 'playwright-core';
import { COMPUTER_MAX_ELEMENTS, COMPUTER_SCREENSHOT_MAX_BASE64 } from '@atd/agent-contracts';
import { untilCancelled, type Operation } from './operations.js';
import {
  locatorFor,
  READ_TIMEOUT_MS,
  refOf,
  type Element,
  type Origins,
  type PageRead,
  type Pages,
} from './pages.js';
import { parseSnapshot } from './snapshot.js';
import { truncate, visibleValue } from './text.js';

/**
 * `observe`: one read of a page — document, the listed elements of its allowed frames (bounded,
 * values masked, the element that has the keyboard focus marked `focused`), a `newText` baseline
 * and, on request, a PNG of the viewport. It sends nothing that changes the page.
 */

const NAME_MAX = 200;
const VALUE_MAX = 200;
const SCREENSHOT_TIMEOUT_MS = 5_000;
/** Same-role, same-name elements of one frame checked one by one for the focus. */
const FOCUS_CANDIDATES = 20;
/**
 * Whether this frame holds the page's focused element: its document has the focus and its
 * active element is neither the body nor a frame (whose own document holds the focus instead).
 */
const HOLDS_FOCUS = `(() => {
  const active = document.activeElement;
  return document.hasFocus() && active !== null && active !== document.body &&
    active !== document.documentElement && active.tagName !== 'IFRAME' && active.tagName !== 'FRAME';
})()`;

interface ObservedElement {
  ref: string;
  role: string;
  name?: string;
  value?: string;
  enabled: boolean;
  focused?: true;
}

/**
 * The listed element that has the keyboard focus, as the accessibility tree's `focused` reported
 * it before: in the frame whose document holds the focus, the element matching `:focus` by role
 * and name (one by one when several share them). None when the focus is elsewhere, on an element
 * that is not listed, or the page could not tell.
 */
async function focusedElement(op: Operation, read: PageRead): Promise<Element | undefined> {
  for (const frame of new Set(read.elements.map((element) => element.frame))) {
    try {
      if (frame.isDetached() || (await untilCancelled(op, frame.evaluate(HOLDS_FOCUS))) !== true)
        continue;
      // The innermost match: a shadow host matches `:focus` as well as the element inside it.
      // Counted first, so a document whose focus no selector matches never waits for one.
      const matches = frame.locator('*:focus');
      if ((await untilCancelled(op, matches.count())) === 0) return undefined;
      const snapshot = matches.last().ariaSnapshot({ timeout: READ_TIMEOUT_MS });
      const [own] = parseSnapshot((await untilCancelled(op, snapshot)).split('\n')[0] ?? '');
      if (own === undefined) return undefined;
      const candidates = read.elements.filter(
        (element) =>
          element.frame === frame && element.role === own.role && element.name === own.name,
      );
      if (candidates.length <= 1) return candidates[0];
      for (const candidate of candidates.slice(0, FOCUS_CANDIDATES)) {
        const check = locatorFor(candidate).evaluate((node) => node.matches(':focus'), undefined, {
          timeout: READ_TIMEOUT_MS,
        });
        if ((await untilCancelled(op, check)) === true) return candidate;
      }
      return undefined;
    } catch (error) {
      if (op.signal.aborted) throw error;
    }
  }
  return undefined;
}

type Screenshot =
  | { screenshot: { mime: 'image/png'; base64: string } }
  | { screenshotOmitted: 'tooLarge' | 'failed' };

async function captureScreenshot(op: Operation, page: Page): Promise<Screenshot> {
  try {
    await clearTypingFeedback(page);
    const shot = page.screenshot({ type: 'png', timeout: SCREENSHOT_TIMEOUT_MS });
    const base64 = (await untilCancelled(op, shot)).toString('base64');
    if (base64.length === 0) return { screenshotOmitted: 'failed' };
    if (base64.length > COMPUTER_SCREENSHOT_MAX_BASE64) return { screenshotOmitted: 'tooLarge' };
    return { screenshot: { mime: 'image/png', base64 } };
  } catch (error) {
    if (op.signal.aborted) throw error;
    return { screenshotOmitted: 'failed' };
  }
}

export async function observe(
  pages: Pages,
  op: Operation,
  input: { pageId: string; screenshot: boolean; allowedOrigins?: Origins },
): Promise<Record<string, unknown>> {
  return pages.withPage(op, input.pageId, async (page) => {
    const read = await pages.read(op, input.pageId, page, input.allowedOrigins);
    const baselineId = await pages.captureBaseline(op, input.pageId, page);
    const focused = await focusedElement(op, read);
    const elements = read.elements.slice(0, COMPUTER_MAX_ELEMENTS).map((element) => {
      const observed: ObservedElement = {
        ref: refOf(read, element),
        role: element.role,
        enabled: !element.disabled,
      };
      if (element.name !== '') observed.name = truncate(element.name, NAME_MAX);
      if (element.value !== undefined)
        observed.value = visibleValue(element.name, element.value, VALUE_MAX);
      if (element === focused) observed.focused = true;
      return observed;
    });
    const screenshot = input.screenshot ? await captureScreenshot(op, page) : {};
    return {
      url: truncate(read.url, 2048),
      title: truncate(read.title, 500),
      elements,
      truncated: read.elements.length > COMPUTER_MAX_ELEMENTS,
      baselineId,
      ...screenshot,
    };
  });
}
