import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import { useInView } from '../../lib/use-in-view';
import { useReducedMotion } from '../../lib/use-reduced-motion';

export type SummonKey = 'meta' | 'shift' | 'space';

type Held = Readonly<Record<SummonKey, boolean>>;

const NONE: Held = { meta: false, shift: false, space: false };

/** The chord in the order it is pressed; the demo's own key presses follow it. */
const CHORD: readonly SummonKey[] = ['meta', 'shift', 'space'];

interface DemoState {
  open: boolean;
  /** How often the panel was hidden; once it comes back, the drawing marks the draft as kept. */
  hides: number;
  /** Who moved the panel last. Only the visitor's own moves are announced. */
  by: 'none' | 'entrance' | 'visitor';
}

type DemoAction = { type: 'toggle' } | { type: 'entrance' };

function reduce(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case 'entrance':
      return state.by === 'none' ? { ...state, open: true, by: 'entrance' } : state;
    case 'toggle':
      return {
        open: !state.open,
        hides: state.open ? state.hides + 1 : state.hides,
        by: 'visitor',
      };
  }
}

function keyOf(event: KeyboardEvent): SummonKey | null {
  if (event.key === 'Meta') return 'meta';
  if (event.key === 'Shift') return 'shift';
  if (event.code === 'Space') return 'space';
  return null;
}

function isChord(event: KeyboardEvent): boolean {
  return (
    event.code === 'Space' && event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey
  );
}

export type DemoPhase = 'idle' | 'shown' | 'hidden';

/**
 * The summon demo. The panel opens once by itself when the display first comes into view (pressing
 * the chord on the keycaps), then the visitor toggles it with the button or the real ⌘ ⇧ Space. While
 * the section is near the viewport, the keycaps follow the physical keys.
 */
export function useSummonDemo(
  stageRef: RefObject<Element | null>,
  displayRef: RefObject<Element | null>,
) {
  const reduced = useReducedMotion();
  const [state, dispatch] = useReducer(reduce, { open: false, hides: 0, by: 'none' });
  const [held, setHeld] = useState<Held>(NONE);
  /** How many keys of the chord the demo itself holds down, in chord order. */
  const [chord, setChord] = useState(0);
  const chordTimers = useRef<number[]>([]);
  const near = useInView(stageRef, { rootMargin: '240px 0px' });
  const seen = useInView(displayRef, { threshold: 0.6, once: true });

  const playChord = useCallback((stepped: boolean) => {
    for (const timer of chordTimers.current) window.clearTimeout(timer);
    const steps: [number, number][] = stepped
      ? [
          [0, 1],
          [90, 2],
          [180, 3],
          [400, 0],
        ]
      : [
          [0, 3],
          [160, 0],
        ];
    chordTimers.current = steps.map(([delay, count]) =>
      window.setTimeout(() => setChord(count), delay),
    );
  }, []);

  useEffect(() => {
    const timers = chordTimers;
    return () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    };
  }, []);

  // The entrance: the chord goes down key by key and the panel springs up as the last key lands.
  // A visitor who toggled first, or who asked for reduced motion, skips the choreography.
  useEffect(() => {
    if (!seen || state.by !== 'none') return;
    if (reduced) {
      dispatch({ type: 'entrance' });
      return;
    }
    playChord(true);
    const timer = window.setTimeout(() => dispatch({ type: 'entrance' }), 200);
    return () => window.clearTimeout(timer);
  }, [seen, state.by, reduced, playChord]);

  useEffect(() => {
    if (!near) return;
    const press = (event: KeyboardEvent) => {
      const key = keyOf(event);
      if (key) setHeld((current) => (current[key] ? current : { ...current, [key]: true }));
      if (!isChord(event)) return;
      event.preventDefault();
      if (!event.repeat) dispatch({ type: 'toggle' });
    };
    const release = (event: KeyboardEvent) => {
      const key = keyOf(event);
      if (!key) return;
      // macOS sends no keyup for other keys while Command is down, so letting go of Command lets go
      // of every key.
      setHeld((current) => {
        if (key === 'meta') return NONE;
        return current[key] ? { ...current, [key]: false } : current;
      });
    };
    const releaseAll = () => setHeld(NONE);
    window.addEventListener('keydown', press);
    window.addEventListener('keyup', release);
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('keydown', press);
      window.removeEventListener('keyup', release);
      window.removeEventListener('blur', releaseAll);
      releaseAll();
    };
  }, [near]);

  const toggle = useCallback(() => {
    dispatch({ type: 'toggle' });
    playChord(false);
  }, [playChord]);

  const phase: DemoPhase = state.open ? 'shown' : state.hides > 0 ? 'hidden' : 'idle';

  return {
    open: state.open,
    phase,
    /** The panel is back after being hidden, with the same draft. */
    kept: state.open && state.hides > 0,
    /** What to announce, or null while nothing the visitor did has changed the panel. */
    announced: state.by === 'visitor' ? phase : null,
    near,
    pressed: (key: SummonKey) => held[key] || chord > CHORD.indexOf(key),
    toggle,
  };
}
