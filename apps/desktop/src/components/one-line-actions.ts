import { useCallback, useState } from 'react';

/**
 * Action bars stay one line, as the island's footers do (`IslandFooterRow`): when a bar's actions
 * would run past it, its secondary actions (marked `data-bar-action`: `BarAction` shows its icon
 * alone, `SettingsFooterSwitch` its switch) give up their labels one at a time from the leading
 * end until the rest fit, so the actions nearest the primary one keep their labels longest. The
 * primary action and actions with no compact form keep their labels. The bar decides from its own
 * layout at full labels, in the language it shows, and decides again when its room or its content
 * changes, so more room gives the labels back.
 *
 * A bar is short of room when its first or last shown child stands past its content box, however
 * it aligns them; so nothing in it may wrap, and its actions and their groups may not shrink.
 */
const ACTION = '[data-bar-action]';

/** Whether `bar`'s children run past either side of its content box. */
function overflows(bar: HTMLElement): boolean {
  const shown = [...bar.children].filter((child) => child.getClientRects().length > 0);
  const first = shown[0];
  const last = shown.at(-1);
  if (!first || !last) return false;
  const box = bar.getBoundingClientRect();
  // Drawn scaled (a dialog opening), the bar's padding is too.
  const scale = bar.offsetWidth > 0 ? box.width / bar.offsetWidth : 1;
  const style = getComputedStyle(bar);
  const start =
    box.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * scale;
  const end =
    box.right - (parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight)) * scale;
  return (
    first.getBoundingClientRect().left < start - 0.5 ||
    last.getBoundingClientRect().right > end + 0.5
  );
}

/** Compacts `bar`'s actions from the leading end until it fits; full labels when it does. */
function fit(bar: HTMLElement): void {
  const actions = [...bar.querySelectorAll<HTMLElement>(ACTION)];
  for (const action of actions) action.removeAttribute('data-compact');
  for (const action of actions) {
    if (!overflows(bar)) return;
    action.setAttribute('data-compact', '');
  }
}

/** Keeps `bar` on one line until the returned function is called. */
export function keepOneLine(bar: HTMLElement): () => void {
  let frame = 0;
  // A fit resizes the bar's groups, which the observer then reports: fit again in the next frame,
  // outside the observer's delivery, where the same layout gives the same answer.
  const resize = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => fit(bar));
  });
  const observe = () => {
    resize.disconnect();
    resize.observe(bar);
    for (const child of bar.children) resize.observe(child);
  };
  // A label that changes (Save becoming Saving…) or an action that comes or goes. Attribute changes
  // are left out: the fit's own would call it again.
  const content = new MutationObserver(() => {
    observe();
    fit(bar);
  });
  fit(bar);
  observe();
  content.observe(bar, { childList: true, subtree: true, characterData: true });
  return () => {
    content.disconnect();
    resize.disconnect();
    cancelAnimationFrame(frame);
    for (const action of bar.querySelectorAll(ACTION)) action.removeAttribute('data-compact');
  };
}

/**
 * For an action in such a bar: the ref that marks it, and whether its bar has compacted it, so it
 * can name itself in a tooltip. Its label stays in place, out of sight (`data-slot="bar-label"`),
 * as its accessible name.
 */
export function useCompacted<T extends HTMLElement>() {
  const [compact, setCompact] = useState(false);
  const ref = useCallback((action: T | null) => {
    if (!action) return;
    const sync = () => setCompact(action.hasAttribute('data-compact'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(action, { attributes: true, attributeFilter: ['data-compact'] });
    return () => observer.disconnect();
  }, []);
  return { ref, compact };
}

/** Ref for a bar of actions that stays one line (`keepOneLine`). */
export function useOneLineActions<T extends HTMLElement>() {
  return useCallback((bar: T | null) => (bar ? keepOneLine(bar) : undefined), []);
}
