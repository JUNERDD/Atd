import { useEffect, useRef, useState } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';
/**
 * How many clips past the current one are rendered on the stage once the steps are in view, so
 * their videos have loaded by the time the reading line reaches them.
 */
const AHEAD = 2;

/** The id a URL hash names, or '' (also for a hash that isn't valid percent-encoding). */
function fragmentOf(hash: string) {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return '';
  }
}

/** The middle of an element's box, from the viewport's top. */
function middleOf(element: Element) {
  const box = element.getBoundingClientRect();
  return box.top + box.height / 2;
}

/**
 * Follows the scroll through the showcase's steps (steps.tsx). The reading line is the display's
 * middle where the display holds beside the steps (cases.css), and the viewport's middle where the
 * steps stack on their own; the current step is the one whose middle is nearest it. The rail is lit
 * from the first step's light down to the reading line, 1:1 with the scroll (`--rail-fill`). Layout
 * is measured on resize; a scroll only reads the list's and the display's positions, at most once a
 * frame, and only while the showcase is on or near the screen.
 *
 * Clips play on their own clock (clip.tsx), not the scroll's: `playing` turns on once the steps
 * come into view, and from then the current clip plays from the start each time it becomes
 * current. Before that, and without the hook (the prerendered page, no script), the showcase has no
 * `data-timeline`: every step's line shows and the first clip's poster rests on the stage.
 *
 * Only the clips the visitor is close to are rendered on the stage (`reach`): the first one until
 * the steps come into view, then up to `AHEAD` clips past the current one, and a rendered clip
 * stays rendered. The showcase hides the rest with `display: none`, so their posters and videos
 * don't load with the page, though every clip stays in the prerendered markup.
 *
 * Each step has its own link, its case's id as the URL's hash: a page opened on it, or a link
 * followed to it, brings that step to the reading line, and choosing a step does the same and puts
 * its link in the address bar without adding a history entry. A neighbouring step glides there; a
 * farther one jumps, so the clips in between don't flash by. `ids` should keep its identity across
 * renders (a module constant): a new array sets the timeline up again.
 */
export function useCaseTimeline(ids: readonly string[]) {
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const display = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reach, setReach] = useState(0);
  /** Brings a step to the reading line; set while the timeline runs. */
  const bring = useRef<(index: number, smooth: boolean) => void>(undefined);
  const current = useRef(0);

  useEffect(() => {
    const showcase = root.current;
    const list = frame.current;
    const screen = display.current;
    const hold = screen?.parentElement;
    const rail = list?.querySelector<HTMLElement>('[data-case-rail]');
    if (!showcase || !list || !screen || !hold || !rail) return;
    const steps = Array.from(list.querySelectorAll<HTMLElement>('[data-case-step]'));
    const lights = Array.from(list.querySelectorAll<HTMLElement>('[data-case-node]'));
    let middles: number[] = [];
    let first = 0;
    let last = 0;
    let beside = false;
    let pending = 0;
    let awake = false;
    let landed = false;

    const line = () => (beside ? middleOf(screen) : innerHeight / 2);
    // Where the reading line rests once the display holds: its sticky place plus half its height.
    const rest = () =>
      beside
        ? (Number.parseFloat(getComputedStyle(hold).top) || 0) + screen.offsetHeight / 2
        : innerHeight / 2;

    const update = () => {
      pending = 0;
      const at = line() - list.getBoundingClientRect().top;
      let index = 0;
      middles.forEach((middle, step) => {
        if (Math.abs(middle - at) < Math.abs((middles[index] ?? 0) - at)) index = step;
      });
      current.current = index;
      setActive(index);
      if (awake) setReach((reached) => Math.max(reached, index + AHEAD));
      const fill = last > first ? Math.min(1, Math.max(0, (at - first) / (last - first))) : 0;
      rail.style.setProperty('--rail-fill', fill.toFixed(4));
    };
    const schedule = () => {
      if (pending === 0) pending = requestAnimationFrame(update);
    };
    bring.current = (index, smooth) => {
      const step = steps[index];
      if (!step) return;
      const top = middleOf(step) + scrollY - rest();
      scrollTo({ top: Math.round(top), behavior: smooth ? 'smooth' : 'instant' });
    };
    const follow = () => {
      const index = ids.indexOf(fragmentOf(location.hash));
      if (index >= 0) bring.current?.(index, false);
    };
    // A case's link lands on its step once the steps are measured; a reload or a step through
    // history keeps the position the browser restores instead.
    const land = () => {
      const [navigation] = performance.getEntriesByType('navigation');
      if (navigation instanceof PerformanceNavigationTiming && navigation.type !== 'navigate')
        return;
      follow();
    };
    const measure = () => {
      // Narrow, the stage's column is not rendered and each step shows its own clip.
      beside = screen.getClientRects().length > 0;
      const top = list.getBoundingClientRect().top;
      middles = steps.map((step) => middleOf(step) - top);
      const edge = lights.at(-1);
      first = lights[0] && beside ? middleOf(lights[0]) - top : 0;
      last = edge && beside ? middleOf(edge) - top : 0;
      rail.style.setProperty('--rail-start', `${first}px`);
      rail.style.setProperty('--rail-length', `${last - first}px`);
      if (!landed) land();
      landed = true;
      schedule();
    };

    showcase.setAttribute('data-timeline', '');
    window.addEventListener('hashchange', follow);
    const resize = new ResizeObserver(measure);
    resize.observe(list);
    resize.observe(screen);
    const near = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          window.addEventListener('scroll', schedule, { passive: true });
          schedule();
        } else {
          window.removeEventListener('scroll', schedule);
        }
      },
      { rootMargin: '50% 0px' },
    );
    near.observe(showcase);
    // The scenes start playing once the steps are a quarter of the way up the viewport.
    const wake = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        awake = true;
        setPlaying(true);
        wake.disconnect();
        schedule();
      },
      { rootMargin: '0px 0px -25% 0px' },
    );
    wake.observe(list);

    return () => {
      showcase.removeAttribute('data-timeline');
      window.removeEventListener('hashchange', follow);
      window.removeEventListener('scroll', schedule);
      resize.disconnect();
      near.disconnect();
      wake.disconnect();
      bring.current = undefined;
      cancelAnimationFrame(pending);
    };
  }, [ids]);

  /** Goes to a step the visitor chose and shows its link in the address bar. */
  function choose(index: number) {
    const id = ids[index];
    if (id === undefined) return;
    history.replaceState(history.state, '', `#${id}`);
    const near = Math.abs(index - current.current) <= 1;
    bring.current?.(index, near && !matchMedia(REDUCED).matches);
  }

  return { root, frame, display, active, playing, reach, choose };
}
