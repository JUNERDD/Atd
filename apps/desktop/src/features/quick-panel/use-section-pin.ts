import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { animate, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import type { QuickGroup } from './quick-options';

/** A group with a heading: a stop of the section bar and of ⌘↑ / ⌘↓, in list order. */
export type QuickSection = Extract<QuickGroup, { heading: string }>;

/** The visible groups that are sections; the heading-less trailing "Browse files…" group is not. */
export function sectionsOf(groups: readonly QuickGroup[]): QuickSection[] {
  return groups.filter((group): group is QuickSection => group.heading !== undefined);
}

/** The pinned row's scrolling, as the selection model (use-quick-panel.ts) drives it. */
export interface SectionScroller {
  /** Scrolls section `index`'s heading into the pinned slot; animated unless Reduce Motion is on. */
  scrollTo(index: number): void;
  /** Ends a running jump scroll where it is. */
  stop(): void;
}

/** What the pinned row renders from; each value changes only at a boundary, never per frame. */
export interface PinState {
  /** Off the top: the overlay draws the pinned labels and the inline headings under them hide. */
  scrolled: boolean;
  /** The section whose heading holds the pinned slot: the last at or above the top, else the first. */
  pinned: number;
  /** Scrolled to the end, or nothing to scroll. */
  atBottom: boolean;
}

const REST: PinState = { scrolled: false, pinned: 0, atBottom: true };
const AREA = '[data-slot="scroll-area"]';
const VIEWPORT = '[data-slot="scroll-area-viewport"]';
const HEADING = '[cmdk-group-heading]';
/** Subpixel slack, as in the scroll area's own edge checks: a heading this near the top is pinned. */
const EDGE_PX = 1;
const JUMP_SECONDS = 0.24;

/**
 * The boundary state as an external store: a change notified from a frame or resize callback
 * renders synchronously (a microtask), unlike state set there, so labels the overlay adds for a
 * first scroll are in the DOM and placed before that frame paints.
 */
function createPinStore() {
  let state = REST;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next: PinState) => {
      if (
        next.scrolled === state.scrolled &&
        next.pinned === state.pinned &&
        next.atBottom === state.atBottom
      )
        return;
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * One frame of the pinned row. With y a heading's top below the viewport's and H its height, label
 * i sits at p = min(max(y_i, 0), y_{i+1} − H), so the next heading pushes it up (the last has
 * none), and shows while y_i < H and p > −H; the inline heading hides while y_i < H. Only a
 * scrolled viewport pins: at rest the inline headings show. Labels pair with cmdk's headings by
 * position, so until the overlay has rendered them (one commit after the first scroll) the inline
 * headings stay.
 */
function place(viewport: HTMLElement, list: HTMLElement, overlay: HTMLElement | null): PinState {
  const { scrollTop, clientHeight, scrollHeight } = viewport;
  const scrolled = scrollTop > 0;
  const top = viewport.getBoundingClientRect().top;
  const headings = Array.from(list.querySelectorAll<HTMLElement>(HEADING), (heading) => ({
    heading,
    y: heading.getBoundingClientRect().top - top,
  }));
  const labels = Array.from(overlay?.children ?? []).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  const paired = labels.length === headings.length;
  const height = headings[0]?.heading.offsetHeight ?? 0;
  let pinned = 0;
  headings.forEach(({ heading, y }, index) => {
    if (y <= EDGE_PX) pinned = index;
    const label = paired ? labels[index] : undefined;
    const covered = scrolled && label !== undefined && y < height;
    heading.style.visibility = covered ? 'hidden' : '';
    if (!label) return;
    const pushed = Math.min(Math.max(y, 0), (headings[index + 1]?.y ?? Infinity) - height);
    label.style.transform = `translateY(${pushed}px)`;
    // An unplaced label keeps its class's `invisible`.
    label.style.visibility = covered && pushed > -height ? 'visible' : '';
  });
  return { scrolled, pinned, atBottom: scrollTop + clientHeight >= scrollHeight - EDGE_PX };
}

/**
 * The quick panel list's pinned row (quick-panel-sections.tsx): sticky headings with push, drawn
 * over the list. `position: sticky` cannot do it on the glass popover: the heading would need a
 * fill (an opaque one is a second surface inside the glass; the glass washes let rows show
 * through), a backdrop blur stacks glass on glass, and the scroller's edge mask would hide it. So
 * cmdk's headings stay in the list, naming their groups, and an `aria-hidden` overlay draws the
 * pinned labels with the same classes; the handoff between them is pixel-identical.
 *
 * Every frame (a rAF-throttled scroll, a resize of the list or its viewport, a section change)
 * places the labels imperatively; React state holds only `PinState`. It also runs jumps: the
 * section's heading glides into the pinned slot, and a new jump, a keyboard move, a wheel, a
 * pointer press in the list, closing, or unmounting stops the glide where it is.
 */
export function useSectionPin({
  list,
  sections,
  open,
}: {
  /** The cmdk list; its scroll-area viewport ancestor is the scroller. */
  list: HTMLElement | null;
  sections: readonly QuickSection[];
  open: boolean;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const [store] = useState(createPinStore);
  const pin = useSyncExternalStore(store.subscribe, store.get, () => REST);
  const signature = sections.map((section) => section.id).join('\n');
  const sync = useRef(() => {});
  const reduced = useReducedMotion();
  // The section a jump is gliding to, which the bar highlights until the glide ends or stops.
  const [target, setTarget] = useState<number | null>(null);
  const jump = useRef<AnimationPlaybackControls | null>(null);

  const stop = useCallback(() => {
    if (!jump.current) return;
    jump.current.stop();
    jump.current = null;
    setTarget(null);
  }, []);

  // Rebinds per section list, so a changed list is placed in the commit that renders it.
  useLayoutEffect(() => {
    const area = list?.closest<HTMLElement>(AREA);
    const viewport = list?.closest<HTMLElement>(VIEWPORT);
    if (!list || !area || !viewport) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // Without layout (jsdom) there is nothing to place.
      if (viewport.clientHeight > 0) store.set(place(viewport, list, overlay.current));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    viewport.addEventListener('scroll', schedule, { passive: true });
    // The area also holds the scrollbar, whose drag must stop a glide too.
    area.addEventListener('wheel', stop, { passive: true });
    area.addEventListener('pointerdown', stop);
    const observer = new ResizeObserver(update);
    observer.observe(list);
    observer.observe(viewport);
    sync.current = update;
    update();
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('scroll', schedule);
      area.removeEventListener('wheel', stop);
      area.removeEventListener('pointerdown', stop);
      observer.disconnect();
      sync.current = () => {};
      for (const heading of list.querySelectorAll<HTMLElement>(HEADING))
        heading.style.visibility = '';
    };
  }, [list, signature, store, stop]);

  // The overlay renders its labels only while scrolled; place them in the commit that adds them.
  useLayoutEffect(() => {
    sync.current();
  }, [pin.scrolled]);

  useEffect(() => {
    if (!open) stop();
  }, [open, stop]);
  useEffect(() => () => jump.current?.stop(), []);

  const scrollTo = useCallback(
    (index: number) => {
      const viewport = list?.closest<HTMLElement>(VIEWPORT);
      const heading = list?.querySelectorAll<HTMLElement>(HEADING)[index];
      if (!viewport || !heading) return;
      stop();
      // The scrollTop that puts the heading at the top, clamped to the scroll range.
      const offset = heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      const max = viewport.scrollHeight - viewport.clientHeight;
      const goal = Math.min(Math.max(viewport.scrollTop + offset, 0), max);
      const distance = goal - viewport.scrollTop;
      if (reduced || Math.abs(distance) < EDGE_PX) {
        viewport.scrollTop = goal;
        return;
      }
      // A long way starts half a viewport short, so the glide stays short and reads as one move.
      if (Math.abs(distance) > 1.2 * viewport.clientHeight)
        viewport.scrollTop = goal - Math.sign(distance) * 0.5 * viewport.clientHeight;
      setTarget(index);
      const controls = animate(viewport.scrollTop, goal, {
        duration: JUMP_SECONDS,
        ease: 'easeOut',
        onUpdate: (value) => {
          viewport.scrollTop = value;
        },
        // Called once the glide finishes (never on `stop`), asynchronously.
        onComplete: () => {
          if (jump.current !== controls) return;
          jump.current = null;
          setTarget(null);
        },
      });
      jump.current = controls;
    },
    [list, reduced, stop],
  );

  /** A wheel over the pinned row or the section bar, which lie outside the scroller, scrolls the
   * list as it would over the rows, and like a wheel in the list stops a glide. */
  const scrollBy = useCallback(
    (deltaY: number) => {
      const viewport = list?.closest<HTMLElement>(VIEWPORT);
      if (!viewport) return;
      stop();
      viewport.scrollTop += deltaY;
    },
    [list, stop],
  );

  return { ...pin, target, overlay, scrollTo, scrollBy, stop };
}
