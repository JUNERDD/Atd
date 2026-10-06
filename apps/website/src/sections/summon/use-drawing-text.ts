import { useEffect, useRef, type RefObject } from 'react';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { createTextEffects, type TextEffects } from '../../motion/text-effects';

/** The panel's dimension labels count from when they start to fade in (panel.css, display.css). */
const MEASURE_DELAY_MS = 280;

/**
 * The drawing's live text. Each time the panel opens, its dimensions and the two edge gaps count up
 * from zero, as if measured; whenever the state readout changes, the new state decodes. The labels
 * are static text nodes, so the effects rewrite them in place and end on the rendered text. Nothing
 * plays on the first render or under reduced motion, where the labels simply fade.
 */
export function useDrawingText(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  state: string,
): void {
  const reduced = useReducedMotion();
  const effects = useRef<TextEffects | null>(null);
  /** What the drawing showed last, so only changes play. */
  const last = useRef({ open, state });

  useEffect(() => {
    const instance = createTextEffects();
    effects.current = instance;
    return () => {
      instance.stop();
      effects.current = null;
    };
  }, []);

  useEffect(() => {
    const opened = open && !last.current.open;
    last.current.open = open;
    if (!opened || reduced || !effects.current) return;
    for (const label of ref.current?.querySelectorAll<HTMLElement>('.summon__dim, .summon__gap') ??
      []) {
      effects.current.play(label, 'count', MEASURE_DELAY_MS);
    }
  }, [ref, open, reduced]);

  useEffect(() => {
    const changed = state !== last.current.state;
    last.current.state = state;
    const readout = ref.current?.querySelector<HTMLElement>('.summon__state');
    if (!changed || reduced || !readout || !effects.current) return;
    effects.current.play(readout, 'decode', 0);
  }, [ref, state, reduced]);
}
