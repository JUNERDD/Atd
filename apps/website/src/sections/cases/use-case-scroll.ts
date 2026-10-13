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
 */
export function useCaseScroll(count: number) {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const track = root.current;
    const pinned = stage.current;
    const head = heading.current;
    const box = screen.current?.parentElement;
    if (!track || !pinned || !head || !box) return;
    const parts = Array.from(pinned.querySelectorAll<HTMLElement>(':scope > *'));
    const fills = Array.from(track.querySelectorAll<HTMLElement>(FILL));
    const clock = createSceneClock(Array.from(box.querySelectorAll<HTMLElement>('.cases__slide')));
    const reduced = matchMedia(REDUCED);
    let distance = 0;
    let sticky = 0;
    let lead = 0;
    let frame = 0;

    const update = () => {
      frame = 0;
      // How far the track has scrolled past the stage's pinned place: negative while the stage is
      // still rising toward it, then the distance the pinned stage has travelled down its track.
      const travelled = sticky - track.getBoundingClientRect().top;
      const passed = Math.min(distance, Math.max(0, travelled));
      const position = distance > 0 ? (passed / distance) * count : 0;
      const index = Math.min(count - 1, Math.floor(position));
      setActive(index);
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
    reduced.addEventListener('change', scrub);

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

    return () => {
      track.removeAttribute('data-scrub');
      reduced.removeEventListener('change', scrub);
      resize.disconnect();
      near.disconnect();
      window.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frame);
    };
  }, [count]);

  /**
   * Scrolls straight to a scene's step, into the rest after its choreography, so the scene shows
   * complete: the stage then sits at its sticky offset with the track that far above it. While the
   * stage is pinned the page doesn't visibly move, so the jump only changes the scene; a smooth
   * scroll would flash and play every scene in between.
   */
  function select(index: number) {
    const track = root.current;
    const pinned = stage.current;
    if (!track || !pinned) return;
    const distance = track.offsetHeight - pinned.offsetHeight;
    const sticky = Number.parseFloat(getComputedStyle(pinned).top) || 0;
    const top = track.getBoundingClientRect().top + window.scrollY - sticky;
    const into = index + (PLAY + 1) / 2;
    window.scrollTo({ top: Math.round(top + (distance * into) / count), behavior: 'instant' });
  }

  return { root, stage, heading, screen, active, select };
}
