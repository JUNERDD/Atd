import { useEffect, useRef, useState } from 'react';
import { useInView } from '../../lib/use-in-view';

/** Marks the index bars whose fill follows the scroll (`--case-fill`, cases.css). */
const FILL = '[data-case-fill]';

/**
 * Drives the showcase from the page's scroll position. The track is one stage tall plus one step of
 * scrolling per scene (cases.css), and the sticky stage stays pinned while those steps pass: how far
 * the stage has travelled down its track picks the scene, and how far into its step it is fills that
 * scene's bar, so the bars move 1:1 with the scroll. Layout is measured on resize; a scroll only
 * reads the two boxes' tops, at most once a frame, and only while the track is on or near the screen.
 *
 * The stage opens with the section's heading. Measuring also decides whether the heading pins with
 * the screen: it does when the viewport below the nav holds it, a full-size screen, the caption and
 * the progress (`data-titled`); otherwise the stage is taller by the heading (`--stage-head`) and
 * pins that much higher, so the screen keeps its size, and the heading fades while the stage is
 * pinned (`data-pinned`). Whatever height is still unused is shared above and below
 * (`--stage-slack`).
 */
export function useCaseScroll(count: number) {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const entered = useInView(screen, { threshold: 0.2 });
  // Scenes wait, hidden, for the first time the screen is seen (scenes.css), then play in.
  const started = useInView(screen, { threshold: 0.4, once: true });

  useEffect(() => {
    const track = root.current;
    const pinned = stage.current;
    const head = heading.current;
    const box = screen.current?.parentElement;
    if (!track || !pinned || !head || !box) return;
    const parts = Array.from(pinned.querySelectorAll<HTMLElement>(':scope > *'));
    const fills = Array.from(track.querySelectorAll<HTMLElement>(FILL));
    let distance = 0;
    let frame = 0;

    const update = () => {
      frame = 0;
      const passed = pinned.getBoundingClientRect().top - track.getBoundingClientRect().top;
      const position = distance > 0 ? Math.min(1, Math.max(0, passed / distance)) * count : 0;
      const index = Math.min(count - 1, Math.floor(position));
      setActive(index);
      if (pinned.hasAttribute('data-pinned') !== passed > 0.5) {
        pinned.toggleAttribute('data-pinned', passed > 0.5);
      }
      fills.forEach((fill, at) => {
        const amount = at < index ? 1 : at > index ? 0 : Math.min(1, position - index);
        fill.style.setProperty('--case-fill', amount.toFixed(4));
      });
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
      // The viewport below the nav, and what the stage needs in it to pin the heading as well.
      const room = pinned.offsetHeight - raised - padding;
      const below = bottom() - (box.offsetTop + box.offsetHeight);
      const titled = head.offsetHeight + box.offsetWidth / 1.6 + below <= room;
      pinned.toggleAttribute('data-titled', titled);
      pinned.style.setProperty('--stage-head', `${titled ? 0 : head.offsetHeight}px`);
      const slack = Math.max(0, pinned.clientHeight - padding - bottom());
      pinned.style.setProperty('--stage-slack', `${Math.round(slack)}px`);
      distance = track.offsetHeight - pinned.offsetHeight;
      schedule();
    };

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
      resize.disconnect();
      near.disconnect();
      window.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frame);
    };
  }, [count]);

  /**
   * Scrolls straight to a scene's step, a pixel in so rounding never lands on the one before: the
   * stage then sits at its sticky offset with the track that far above it. While the stage is pinned
   * the page doesn't visibly move, so the jump only changes the scene; a smooth scroll would flash
   * every scene in between.
   */
  function select(index: number) {
    const track = root.current;
    const pinned = stage.current;
    if (!track || !pinned) return;
    const distance = track.offsetHeight - pinned.offsetHeight;
    const sticky = Number.parseFloat(getComputedStyle(pinned).top) || 0;
    const top = track.getBoundingClientRect().top + window.scrollY - sticky;
    window.scrollTo({ top: Math.ceil(top + (distance * index) / count) + 1, behavior: 'instant' });
  }

  return { root, stage, heading, screen, active, entered, started, select };
}
