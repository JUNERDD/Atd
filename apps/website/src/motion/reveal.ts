import { createTextEffects, isTextEffect } from './text-effects';

const ITEM = '[data-reveal]';
const GROUP = '[data-reveal-group]';
const REDUCED = '(prefers-reduced-motion: reduce)';
/** Default delay between the items of a group, in DOM order. */
const GROUP_STAGGER = 70;
/** Delay between targets that come into view in the same frame, top to bottom. */
const BATCH_STAGGER = 70;
/** Later arrivals in one batch share the last slot, so a long batch never drags. */
const BATCH_MAX = 6;

function ms(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The group an item or a nested group belongs to: its nearest group ancestor. */
function groupOf(element: Element): Element | null {
  return element.parentElement?.closest(GROUP) ?? null;
}

/**
 * Reveals content as it scrolls into view, once, for the attribute protocol in styles/motion.css:
 *
 * - `data-reveal="<effect>"` marks an item. A loose item (outside any group) has its own trigger.
 * - `data-reveal-group` marks a container whose items (those whose nearest group it is) reveal
 *   together when it comes into view, `data-reveal-stagger` ms apart (default 70) in DOM order.
 *   A group nested in another has its own trigger, unless it is also an item of the outer group:
 *   then its items follow its own entrance, timed from its slot.
 * - `data-reveal-delay` adds ms to a group or a loose item; on a group's item it replaces the
 *   item's stagger slot.
 * - A loose `drop` item (a fixed bar, hidden off screen) enters with the page instead.
 *
 * Revealing sets `--rv-delay` and `data-revealed` on each item (CSS plays the effect) and on the
 * group, and starts text effects. Without the root's `data-motion` (reduced motion, or no inline
 * script) items are marked revealed with no effects, so `useRevealed` and `[data-revealed]` styles
 * still see the moment content arrives. Returns the function that stops everything.
 */
export function initReveal(): () => void {
  const root = document.documentElement;
  const motion = root.hasAttribute('data-motion') && !matchMedia(REDUCED).matches;
  const texts = createTextEffects();
  const pending = new Set<HTMLElement>();

  const start = (item: HTMLElement, delay: number) => {
    item.style.setProperty('--rv-delay', `${Math.round(delay)}ms`);
    const effect = item.dataset.reveal;
    item.setAttribute('data-revealed', '');
    if (motion && isTextEffect(effect)) texts.play(item, effect, delay);
  };

  const revealGroup = (group: HTMLElement, base: number) => {
    const stagger = ms(group.dataset.revealStagger, GROUP_STAGGER);
    const items = Array.from(group.querySelectorAll<HTMLElement>(ITEM)).filter(
      (item) => groupOf(item) === group,
    );
    items.forEach((item, index) => {
      const delay = base + ms(item.dataset.revealDelay, index * stagger);
      start(item, delay);
      if (item.matches(GROUP)) revealGroup(item, delay);
    });
    group.setAttribute('data-revealed', '');
  };

  const reveal = (target: HTMLElement, extra: number) => {
    pending.delete(target);
    observer.unobserve(target);
    const delay = extra + ms(target.dataset.revealDelay, 0);
    if (target.matches(ITEM)) start(target, delay);
    if (target.matches(GROUP)) revealGroup(target, delay);
  };

  // Content reveals once its top is a little way into the viewport, so the effect is seen. Content
  // already on screen at its first report (the first screen, or wherever a reload restores the page)
  // reveals with the page, even in the band along the bottom edge that a scroll has to clear.
  const reported = new WeakSet<Element>();
  const arrived = (entry: IntersectionObserverEntry) => {
    const first = !reported.has(entry.target);
    reported.add(entry.target);
    if (entry.isIntersecting) return true;
    const box = entry.boundingClientRect;
    return first && box.top < innerHeight && box.bottom > 0;
  };
  const observer = new IntersectionObserver(
    (entries) => {
      const arriving = entries
        .filter((entry) => arrived(entry) && entry.target instanceof HTMLElement)
        .sort(
          (a, b) =>
            a.boundingClientRect.top - b.boundingClientRect.top ||
            a.boundingClientRect.left - b.boundingClientRect.left,
        );
      arriving.forEach((entry, index) => {
        if (entry.target instanceof HTMLElement) {
          reveal(entry.target, Math.min(index, BATCH_MAX) * BATCH_STAGGER);
        }
      });
    },
    { rootMargin: '0px 0px -8% 0px' },
  );

  // Content in the page's last few percent never crosses that line; at the end of the page, anything
  // still waiting on screen reveals.
  const sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.className = 'reveal-end';
  document.body.append(sentinel);
  const end = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    let index = 0;
    for (const target of pending) {
      if (target.getBoundingClientRect().top < innerHeight) {
        reveal(target, Math.min(index, BATCH_MAX) * BATCH_STAGGER);
        index += 1;
      }
    }
  });
  end.observe(sentinel);

  const watch = (target: HTMLElement) => {
    if (target.hasAttribute('data-revealed')) return;
    pending.add(target);
    observer.observe(target);
  };
  for (const group of document.querySelectorAll<HTMLElement>(GROUP)) {
    // A group that is an item of an outer group reveals with it.
    if (!(group.matches(ITEM) && groupOf(group))) watch(group);
  }
  for (const item of document.querySelectorAll<HTMLElement>(ITEM)) {
    if (groupOf(item) || item.matches(GROUP)) continue;
    // A dropping bar is fixed, and its hidden state is off screen: it enters with the page.
    if (item.dataset.reveal === 'drop') reveal(item, 0);
    else watch(item);
  }
  root.setAttribute('data-motion-ready', '');

  return () => {
    observer.disconnect();
    end.disconnect();
    sentinel.remove();
    texts.stop();
    pending.clear();
    root.removeAttribute('data-motion-ready');
  };
}
