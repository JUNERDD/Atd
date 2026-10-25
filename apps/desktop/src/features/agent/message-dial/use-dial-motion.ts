import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { ConversationControls } from '../transcript/conversation-controls';
import { clamp, rubberBand, TICK_SPACING } from './dial-geometry';
import {
  positionFor,
  readingPlace,
  returnTo,
  scrollFor,
  turnElement,
  turnHeights,
} from './dial-scroll';

/** A press moves the dial only once the pointer has travelled this far; less is a click. */
const DRAG_SLOP_PX = 3;
/** The stretch of a drag's last samples its release velocity is measured over. */
const VELOCITY_WINDOW_MS = 90;
/** How far a release carries on at its velocity before the dial snaps. */
const FLING_MS = 220;
/** The wheel turns the dial this many px per message, and snaps once it has rested this long. */
const WHEEL_PX = TICK_SPACING * 1.5;
const WHEEL_SETTLE_MS = 140;
/** A scroll within this of the dial's own last write is the dial's echo, not the reader's. */
const ECHO_PX = 2;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (k: number) => 1 - (1 - k) ** 3;

type Press = { x: number; start: number; moved: boolean };
type Sample = { time: number; position: number };
/** A running turn: its animation frame and the message it heads for. */
type Turning = { frame: number; target: number };

/**
 * The dial's motion over a conversation: a fractional `position` along its user messages that
 * dragging, flinging, the wheel and the keys turn, and that scrolls the transcript continuously
 * (`scrollFor`) while it turns. Every turn ends on a message, which is then shown (`show`), so the
 * transcript holds it while its content settles; a message the window has not mounted is shown
 * first and the dial only turns to it. Scrolling the transcript itself turns the dial along
 * (`positionFor`); its own scrolling is told apart by the offset it last wrote.
 *
 * `aim` turns a click's clientX into the position it points at. `keep` ends the dial where it is
 * (a turn under way finishes at once), `goBack` returns the transcript to where the reader was when
 * the dial opened.
 */
export function useDialMotion(
  controls: ConversationControls,
  aim: (clientX: number, position: number) => number,
) {
  const latest = useRef(controls);
  useLayoutEffect(() => {
    latest.current = controls;
  });
  const { viewport, prompts } = controls;
  // Opening reads the transcript as it stands: the dial starts at the view's exact position.
  const [position, setPosition] = useState(() =>
    viewport ? positionFor(viewport, prompts) : prompts.length - 1,
  );
  const [dragging, setDragging] = useState(false);
  // Tick lengths follow the turns' rendered heights, measured again as messages come and go (the
  // transcript publishes a new list only once its turns are in the document).
  const [measured, setMeasured] = useState(() => ({
    prompts,
    heights: viewport ? turnHeights(viewport, prompts) : [],
  }));
  if (measured.prompts !== prompts)
    setMeasured({ prompts, heights: viewport ? turnHeights(viewport, prompts) : [] });
  const [element, setElement] = useState<HTMLElement | null>(null);
  const live = useRef(position);
  const turning = useRef<Turning | null>(null);
  const wheelRest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const press = useRef<Press | null>(null);
  const samples = useRef<Sample[]>([]);
  const written = useRef(Number.NaN);
  /** Messages already asked to mount during this opening, so a drag asks once each. */
  const mounting = useRef(new Set<string>());
  /** Where the reader was when the dial opened, for going back. */
  const [origin] = useState(() => (viewport ? readingPlace(viewport) : null));

  function paint(next: number) {
    live.current = next;
    setPosition(next);
  }

  /** Turns the dial to `next` and scrolls the transcript with it, mounting a message it lacks. */
  function drive(next: number) {
    paint(next);
    const { viewport: view, prompts: entries, show } = latest.current;
    if (!view) return;
    const top = scrollFor(view, entries, next);
    if (typeof top === 'number') {
      view.scrollTop = top;
      written.current = view.scrollTop;
    } else if (!mounting.current.has(top.mount)) {
      mounting.current.add(top.mount);
      show(top.mount);
    }
  }

  function stop() {
    if (turning.current) cancelAnimationFrame(turning.current.frame);
    turning.current = null;
    clearTimeout(wheelRest.current);
    wheelRest.current = undefined;
  }

  /** Turns to the message nearest `goal`, eased, and shows it there. */
  function turnTo(goal: number) {
    stop();
    const { viewport: view, prompts: entries, show } = latest.current;
    const target = clamp(Math.round(goal), 0, entries.length - 1);
    const entry = entries[target];
    if (!entry) return;
    // A message outside the window is shown (mounted, then revealed) by the transcript itself.
    const mounted = view !== null && turnElement(view, entry.turnId) !== null;
    if (!mounted) show(entry.turnId);
    const move = mounted ? drive : paint;
    const finish = () => {
      turning.current = null;
      move(target);
      if (mounted) show(entry.turnId);
    };
    const from = live.current;
    const delta = target - from;
    if (reducedMotion() || Math.abs(delta) < 0.001) {
      finish();
      return;
    }
    const duration = Math.min(650, 240 + 50 * Math.abs(delta));
    const start = performance.now();
    const frame = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      if (k >= 1) {
        finish();
        return;
      }
      move(from + delta * easeOut(k));
      if (turning.current) turning.current.frame = requestAnimationFrame(frame);
    };
    turning.current = { frame: requestAnimationFrame(frame), target };
  }

  // The reader's own scrolling turns the dial along; the dial's echo and its turns do not.
  useEffect(() => {
    if (!viewport) return;
    let frame = 0;
    const follow = () => {
      if (press.current || turning.current || wheelRest.current !== undefined) return;
      if (Math.abs(viewport.scrollTop - written.current) < ECHO_PX) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        written.current = Number.NaN;
        paint(positionFor(viewport, latest.current.prompts));
      });
    };
    viewport.addEventListener('scroll', follow, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', follow);
      cancelAnimationFrame(frame);
    };
  }, [viewport]);

  // The wheel and the trackpad turn the dial (it never scrolls the page under it), then it snaps.
  useEffect(() => {
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      stop();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const last = latest.current.prompts.length - 1;
      drive(clamp(live.current + delta / WHEEL_PX, 0, last));
      wheelRest.current = setTimeout(() => {
        wheelRest.current = undefined;
        turnTo(live.current);
      }, WHEEL_SETTLE_MS);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [element]);

  useEffect(() => stop, []);

  const near = clamp(Math.round(position), 0, prompts.length - 1);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    stop();
    press.current = { x: event.clientX, start: live.current, moved: false };
    samples.current = [{ time: event.timeStamp, position: live.current }];
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = press.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    if (!current.moved && Math.abs(dx) <= DRAG_SLOP_PX) return;
    current.moved = true;
    const next = rubberBand(current.start - dx / TICK_SPACING, latest.current.prompts.length);
    drive(next);
    const recent = samples.current;
    recent.push({ time: event.timeStamp, position: next });
    while (recent.length > 2 && event.timeStamp - (recent[0]?.time ?? 0) > VELOCITY_WINDOW_MS)
      recent.shift();
  }

  /** A press without a drag clicks the tick under it; a drag snaps, carried by its velocity. */
  function onPointerUp(event: PointerEvent<HTMLElement>) {
    const current = press.current;
    if (!current) return;
    press.current = null;
    setDragging(false);
    if (!current.moved) {
      turnTo(aim(event.clientX, live.current));
      return;
    }
    const first = samples.current[0];
    const last = samples.current.at(-1);
    const velocity =
      first && last && last.time > first.time
        ? (last.position - first.position) / (last.time - first.time)
        : 0;
    turnTo(live.current + velocity * FLING_MS);
  }

  function onPointerCancel() {
    if (!press.current) return;
    press.current = null;
    setDragging(false);
    turnTo(live.current);
  }

  /** Steps with the arrows, jumps with Home and End; the transcript's ⌥⌘ arrows stay its own. */
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const from = turning.current?.target ?? Math.round(live.current);
    const last = latest.current.prompts.length - 1;
    const goals: Record<string, number> = {
      ArrowLeft: from - 1,
      ArrowUp: from - 1,
      ArrowRight: from + 1,
      ArrowDown: from + 1,
      Home: 0,
      End: last,
    };
    const goal = goals[event.key];
    if (goal === undefined) return;
    event.preventDefault();
    turnTo(goal);
  }

  function keep() {
    const target = turning.current?.target ?? (wheelRest.current ? Math.round(live.current) : null);
    stop();
    const entry = target === null ? undefined : latest.current.prompts[target];
    if (entry) latest.current.show(entry.turnId);
  }

  function goBack() {
    stop();
    const view = latest.current.viewport;
    if (view && origin) returnTo(view, origin, reducedMotion());
  }

  return {
    position,
    near,
    heights: measured.heights,
    dragging,
    keep,
    goBack,
    ref: setElement,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown },
  };
}
