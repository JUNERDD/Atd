import { useEffect, useRef, useState } from 'react';
import { createSceneClock, PLAY } from './scene-clock';

/** Marks each scene name's stretch of the progress line (`--case-fill`, cases.css). */
const FILL = '[data-case-fill]';
const REDUCED = '(prefers-reduced-motion: reduce)';
/**
 * How much of the screen's approach plays the first scene: the share of the scroll from the screen's
 * top edge entering the viewport to the stage pinning. The first scene starts building as the screen
 * rises, so the stage never pins on an empty desktop.
 */
const LEAD = 0.5;
/**
 * How many scenes past the current one are rendered once the screen is in view, so their images
 * have loaded by the time the scroll reaches them.
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

/**
 * Scrolls straight to scene `index` of `count`, into the rest after its choreography, so the scene
 * shows complete: the stage then sits at its sticky offset with the track that far above it. While
 * the stage is pinned the page doesn't visibly move, so the jump only changes the scene; a smooth
 * scroll would flash and play every scene in between.
 */
function showScene(track: HTMLElement, pinned: HTMLElement, index: number, count: number) {
  const distance = track.offsetHeight - pinned.offsetHeight;
  const sticky = Number.parseFloat(getComputedStyle(pinned).top) || 0;
  const top = track.getBoundingClientRect().top + window.scrollY - sticky;
  const into = index + (PLAY + 1) / 2;
  window.scrollTo({ top: Math.round(top + (distance * into) / count), behavior: 'instant' });
}

/**
 * Drives the showcase from the page's scroll position. The track is one stage tall plus one step of
 * scrolling per scene (cases.css), and the sticky stage stays pinned while those steps pass: how
 * far the stage has travelled down its track picks the scene, and the same distance fills the line
 * under the scenes' names up to the current one and into it, so the line moves 1:1 with the scroll.
 * Layout is measured on resize; a scroll only reads the track's top, at most once a frame, and only
 * while the track is on or near the screen.
 *
 * The same scroll plays each scene (scene-clock.ts): within its step the scene's choreography runs
 * as far as the step has scrolled, forwards or backwards, and the first scene also plays while the
 * screen rises into place. Without the hook (the prerendered page, no script, reduced motion) the
 * showcase has no `data-scrub` and every scene is shown complete.
 *
 * The stage opens with the section's heading. Measuring also decides whether the heading pins with
 * the screen: it does when the viewport below the nav holds it, the scenes' names, a full-size
 * screen and the caption (`data-titled`); otherwise the stage is taller by the heading
 * (`--stage-head`) and pins that much higher, so the screen keeps its size, and the heading fades
 * while the stage is pinned (`data-pinned`). Whatever height is still unused is shared above and
 * below (`--stage-slack`).
 *
 * Only the scenes the visitor is close to are rendered (`reach`): the first one until the screen
 * comes into view, then up to `AHEAD` scenes past the current one, and a rendered scene stays
 * rendered. The showcase hides the rest with `display: none`, so their lazy images don't load with
 * the page, though every image stays in the prerendered markup.
 *
 * Each scene has its own link, its id as the URL's hash: a page opened on it, or a link followed to
 * it, goes straight to that scene (`showScene`), and choosing a scene by name puts its link in the
 * address bar without adding a history entry. `ids` should keep its identity across renders (a
 * module constant): a new array sets the showcase up again.
 */
export function useCaseScroll(ids: readonly string[]) {
  const count = ids.length;
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [reach, setReach] = useState(0);
  /** Reads the scenes' animations again and reseeks them; set while the scroll drives the showcase. */
  const rescrub = useRef<() => void>(undefined);

  useEffect(() => {
    const track = root.current;
    const pinned = stage.current;
    const head = heading.current;
    const display = screen.current;
    const box = display?.parentElement;
    if (!track || !pinned || !head || !display || !box) return;
    const parts = Array.from(pinned.querySelectorAll<HTMLElement>(':scope > *'));
    const fills = Array.from(track.querySelectorAll<HTMLElement>(FILL));
    const clock = createSceneClock(Array.from(box.querySelectorAll<HTMLElement>('.cases__slide')));
    const reduced = matchMedia(REDUCED);
    let distance = 0;
    let sticky = 0;
    let lead = 0;
    let frame = 0;
    let awake = false;
    let landed = false;

    const update = () => {
      frame = 0;
      // How far the track has scrolled past the stage's pinned place: negative while the stage is
      // still rising toward it, then the distance the pinned stage has travelled down its track.
      const travelled = sticky - track.getBoundingClientRect().top;
      const passed = Math.min(distance, Math.max(0, travelled));
      const position = distance > 0 ? (passed / distance) * count : 0;
      const index = Math.min(count - 1, Math.floor(position));
      setActive(index);
      if (awake) setReach((reached) => Math.max(reached, index + AHEAD));
      if (pinned.hasAttribute('data-pinned') !== passed > 0.5) {
        pinned.toggleAttribute('data-pinned', passed > 0.5);
      }
      // The names before the current one are done, so the line is lit through them.
      fills.forEach((fill, at) => {
        const amount = Math.min(1, Math.max(0, position - at));
        fill.style.setProperty('--case-fill', amount.toFixed(4));
      });
      const step = distance / count;
      for (let at = 0; at < count; at += 1) {
        const start = at === 0 ? -lead : at * step;
        const end = (at + 1) * step;
        clock.seek(at, end > start ? (travelled - start) / (end - start) : 1);
      }
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    const follow = () => {
      const index = ids.indexOf(fragmentOf(location.hash));
      if (index >= 0) showScene(track, pinned, index, count);
    };
    // Lands the page on its hash once the stage has its first measure: a scene's link goes to that
    // scene, and any other target is aimed at again, because the browser started its (smooth)
    // scroll to it before the measure changed the track's height and moved what follows it. A
    // reload or a step through history keeps the position the browser restores instead.
    const land = () => {
      const [navigation] = performance.getEntriesByType('navigation');
      if (navigation instanceof PerformanceNavigationTiming && navigation.type !== 'navigate')
        return;
      const fragment = fragmentOf(location.hash);
      const index = ids.indexOf(fragment);
      const target = fragment ? document.getElementById(fragment) : null;
      if (index >= 0) showScene(track, pinned, index, count);
      else if (target && !track.contains(target)) target.scrollIntoView({ block: 'start' });
    };
    // The lowest edge of the stage's parts, from the stage's top.
    const bottom = () => Math.max(0, ...parts.map((part) => part.offsetTop + part.offsetHeight));
    const measure = () => {
      const style = getComputedStyle(pinned);
      const padding = Number.parseFloat(style.paddingBlockEnd) || 0;
      const raised = Number.parseFloat(style.getPropertyValue('--stage-head')) || 0;
      // The viewport below the nav, and what the stage needs in it to pin the heading as well:
      // every part as it is, with the screen at its full height.
      const room = pinned.offsetHeight - raised - padding;
      const titled = bottom() - box.offsetHeight + box.offsetWidth / 1.6 <= room;
      pinned.toggleAttribute('data-titled', titled);
      pinned.style.setProperty('--stage-head', `${titled ? 0 : head.offsetHeight}px`);
      const slack = Math.max(0, pinned.clientHeight - padding - bottom());
      pinned.style.setProperty('--stage-slack', `${Math.round(slack)}px`);
      distance = track.offsetHeight - pinned.offsetHeight;
      sticky = Number.parseFloat(style.top) || 0;
      lead = Math.max(0, window.innerHeight - sticky - box.offsetTop) * LEAD;
      if (!landed) land();
      landed = true;
      schedule();
    };
    // scenes.css pauses the scenes' animations under `data-scrub`; they are read back once they
    // exist, and again when the motion preference adds or removes them.
    const scrub = () => {
      clock.collect();
      schedule();
    };
    track.setAttribute('data-scrub', '');
    scrub();
    rescrub.current = scrub;
    reduced.addEventListener('change', scrub);
    window.addEventListener('hashchange', follow);

    const resize = new ResizeObserver(measure);
    resize.observe(track);
    resize.observe(pinned);
    // The heading's and the caption's heights can change on their own, with a font swap.
    for (const part of parts) resize.observe(part);
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
    near.observe(track);
    const wake = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      awake = true;
      wake.disconnect();
      schedule();
    });
    wake.observe(display);

    return () => {
      track.removeAttribute('data-scrub');
      reduced.removeEventListener('change', scrub);
      window.removeEventListener('hashchange', follow);
      resize.disconnect();
      near.disconnect();
      wake.disconnect();
      rescrub.current = undefined;
      window.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frame);
    };
  }, [ids, count]);

  // Scenes rendered for the first time bring their own animations, which the scroll must seek too.
  useEffect(() => rescrub.current?.(), [reach]);

  /** Goes to a scene the visitor chose by name and shows its link in the address bar. */
  function choose(index: number) {
    const id = ids[index];
    const track = root.current;
    const pinned = stage.current;
    if (id === undefined || !track || !pinned) return;
    history.replaceState(history.state, '', `#${id}`);
    showScene(track, pinned, index, count);
  }

  return { root, stage, heading, screen, active, reach, choose };
}
