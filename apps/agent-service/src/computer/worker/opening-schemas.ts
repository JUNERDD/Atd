import * as z from 'zod';
import { common, HttpUrl, OperationId, Origin, PageId } from './schemas.js';

/**
 * The tool schemas of the calls that exist for the imperceptible rule: `page_focus`
 * (occupancy.ts) lets the host see whether the person is using a page, `open_page` (open.ts)
 * opens a page of an approved website in a background tab, or in a new background window that is
 * parked beyond the displays, and `restore_windows` (windows.ts) puts parked windows back on a
 * display for a person who opens the browser themselves. None can focus, raise or activate
 * anything.
 */

/** The most pages one `page_focus` call names: the bound page and the popups it admitted. */
export const FOCUS_PAGES_MAX = 16;

/**
 * A window frame in the browser's window space: points, the origin at the top-left corner of the
 * primary display, y growing downward (CDP `Browser.Bounds`). The host computes every frame from
 * the displays it sees.
 */
export const WindowFrame = z.strictObject({
  left: z.number().int().min(-100_000).max(100_000),
  top: z.number().int().min(-100_000).max(100_000),
  width: z.number().int().min(100).max(20_000),
  height: z.number().int().min(100).max(20_000),
});
export type WindowFrame = z.infer<typeof WindowFrame>;

export const pageFocusInput = {
  pageIds: z.array(PageId).min(1).max(FOCUS_PAGES_MAX),
  operationId: OperationId.optional(),
};
export const pageFocusOutput = {
  ...common,
  /**
   * One entry per named page that is still open (a page that closed is left out). `hasFocus` is
   * what `document.hasFocus()` answers, which Playwright's focus emulation makes true for every
   * page it drives; `visible` is `document.visibilityState === 'visible'`, which is true only
   * for the tab a window shows.
   */
  focus: z
    .array(z.object({ pageId: z.string(), hasFocus: z.boolean(), visible: z.boolean() }))
    .max(FOCUS_PAGES_MAX)
    .optional(),
};

/**
 * `url` is on one of `allowedOrigins` (the host checked it, the worker checks it again). The
 * result's `pageId` is the new page's CDP target id and `url` the address it had committed to
 * when the call returned (empty when the page was not attached in time). With `parkAt`, the page
 * opens in a new window, which is moved to that frame at once (the browser has no window to hold
 * a tab); `parked` is the frame the browser reports for it afterwards, since the system keeps part
 * of a window on a display whatever was asked.
 */
export const openPageInput = {
  url: HttpUrl,
  allowedOrigins: z.array(Origin).min(1).max(32),
  parkAt: WindowFrame.optional(),
  operationId: OperationId.optional(),
};
export const openPageOutput = {
  ...common,
  url: z.string().optional(),
  parked: z
    .object({ left: z.number(), top: z.number(), width: z.number(), height: z.number() })
    .optional(),
};

/**
 * `displays` are the displays' frames; a window of the browser that is mostly outside all of them
 * is moved to `frame`, a normal size on a display. `moved` is how many were.
 */
export const restoreWindowsInput = {
  displays: z.array(WindowFrame).min(1).max(16),
  frame: WindowFrame,
  operationId: OperationId.optional(),
};
export const restoreWindowsOutput = { ...common, moved: z.number().int().min(0).optional() };
