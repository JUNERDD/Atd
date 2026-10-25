import { throwIfCancelled, untilCancelled, type Operation } from './operations.js';
import type { WindowFrame } from './opening-schemas.js';
import type { Pages } from './pages.js';

/**
 * `restore_windows`: puts the managed browser's parked windows back on a display, for a person
 * who opens the browser themselves ("Open browser", "Sign in again"). The host parks the windows a
 * run opens beyond the displays (open.ts), so the person would otherwise find the browser in front
 * of them with nothing to see. A window counts as parked when less than a quarter of its area is
 * on any display, so one the person dragged half off a display stays where it is, and windows are
 * found from the browser itself, which keeps working when the shell restarted since they were
 * parked. Only windows move: no page is focused, raised or activated, and the host brings the
 * browser forward itself, after this call.
 */

/** Windows with less than this share of their area on a display count as parked. */
const PARKED_SHARE = 0.25;

type Bounds = {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  windowState?: string;
};

/** The share of `window`'s area that lies on a display (the displays do not overlap). */
function visibleShare(window: WindowFrame, displays: readonly WindowFrame[]): number {
  let visible = 0;
  for (const display of displays) {
    const width =
      Math.min(window.left + window.width, display.left + display.width) -
      Math.max(window.left, display.left);
    const height =
      Math.min(window.top + window.height, display.top + display.height) -
      Math.max(window.top, display.top);
    if (width > 0 && height > 0) visible += width * height;
  }
  return visible / (window.width * window.height);
}

/** The window frame when it is a normal window whose position is known, else undefined. */
function frameOf(bounds: Bounds): WindowFrame | undefined {
  const { left, top, width, height, windowState } = bounds;
  if (left === undefined || top === undefined || !width || !height) return undefined;
  if (windowState !== undefined && windowState !== 'normal') return undefined;
  return { left, top, width, height };
}

export async function restoreWindows(
  pages: Pages,
  op: Operation,
  input: { displays: readonly WindowFrame[]; frame: WindowFrame },
): Promise<Record<string, unknown>> {
  const browser = await untilCancelled(op, pages.connect());
  const session = await untilCancelled(op, browser.newBrowserCDPSession());
  const seen = new Set<number>();
  let moved = 0;
  try {
    const { targetInfos } = await untilCancelled(op, session.send('Target.getTargets'));
    for (const info of targetInfos) {
      if (info.type !== 'page') continue;
      try {
        const { windowId, bounds } = await untilCancelled(
          op,
          session.send('Browser.getWindowForTarget', { targetId: info.targetId }),
        );
        const frame = frameOf(bounds);
        if (seen.has(windowId) || frame === undefined) continue;
        seen.add(windowId);
        if (visibleShare(frame, input.displays) >= PARKED_SHARE) continue;
        throwIfCancelled(op);
        op.dispatched = true;
        await untilCancelled(
          op,
          session.send('Browser.setWindowBounds', { windowId, bounds: input.frame }),
        );
        moved += 1;
      } catch (error) {
        // A page that has no browser window (an extension view) or a window that refuses to move
        // is left as it is; the other windows still get their turn.
        if (op.signal.aborted) throw error;
      }
    }
  } finally {
    await session.detach().catch(() => undefined);
  }
  return { moved };
}
