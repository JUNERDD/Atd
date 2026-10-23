import { useCallback, useLayoutEffect, useRef } from 'react';
import { GLOW_TIMING } from './glow-field';

interface Retreat {
  from: number;
  to: number;
  start: number;
  duration: number;
}

function sample(retreat: Retreat, now: number) {
  const progress = retreat.duration ? Math.min(1, (now - retreat.start) / retreat.duration) : 1;
  const eased = progress * progress * (3 - 2 * progress);
  return {
    value: retreat.from + (retreat.to - retreat.from) * eased,
    moving: progress < 1,
  };
}

/**
 * One reversible edge retreat, sampled by the field's existing clock. Wall time keeps its end
 * aligned with the CSS fade even when the native window hides and pauses shader drawing.
 */
export function useGlowRetreat(running: boolean, on: boolean) {
  const retreat = useRef<Retreat>({ from: 0, to: 0, start: 0, duration: 0 });
  useLayoutEffect(() => {
    const now = performance.now();
    const from = running ? sample(retreat.current, now).value : 0;
    const to = running && !on ? 1 : 0;
    const duration = (on ? GLOW_TIMING.entry : GLOW_TIMING.exit) * 1000 * Math.abs(to - from);
    retreat.current = { from, to, start: now, duration };
  }, [running, on]);
  return useCallback(() => sample(retreat.current, performance.now()), []);
}
