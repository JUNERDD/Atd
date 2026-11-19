import { Suspense, useCallback, useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { GLOW_TIMING } from './glow-field';
import { GlowField } from './glow-field-loader';
import type { WaitPhase } from './wait-phase';
import './waiting-glow.css';

/**
 * Paper draws with WebGL 2, which WebKit provides; an engine without it (the renderer's jsdom
 * tests) gets no field, so the light never becomes ready and never lights.
 */
const WEBGL2 = typeof WebGL2RenderingContext !== 'undefined';

/**
 * Which fade the light is in, each defined in `waiting-glow.css`: `entry` comes up with the bloom,
 * `exit` ebbs however the wait ends, and `quick` is every fade under Reduce Motion.
 */
type Fade = 'entry' | 'exit' | 'quick';

interface Look {
  on: boolean;
  /** The first output has arrived: the light turns cyan before it fades. */
  writing: boolean;
  fade: Fade;
}

const DARK: Look = { on: false, writing: false, fade: 'exit' };
const LIT: Look = { on: true, writing: false, fade: 'entry' };

/**
 * The command HUD's flowing light behind the panel's composer while the conversation waits for its
 * reply (`waitPhase`). The shader runtime loads after the panel's first frame so it stays off the
 * critical startup bundle while still ready before a message is sent.
 */
export function WaitingGlow({ phase }: { phase: WaitPhase }) {
  const reduced = useReducedMotion() ?? false;
  const [look, setLook] = useState<Look>(DARK);
  /** The field's clock runs while the light shows and through its fade; each run starts a bloom. */
  const [flowing, setFlowing] = useState(false);
  /** The canvas has painted its first frame, so lighting it never shows an empty canvas. */
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
  // Phase changes act during render, so the light comes up in the same frame as the send and the
  // cyan shift in the same frame as the first output, instead of an effect later.
  const [seen, setSeen] = useState(phase);
  if (phase !== seen) {
    setSeen(phase);
    if (phase === 'waiting' && ready && !look.on) {
      setLook(LIT);
      setFlowing(true);
    } else if (look.on && phase === 'answering') setLook({ ...look, writing: true });
    else if (look.on && phase === 'idle') setLook({ ...look, on: false, fade: 'exit' });
  }

  // A wait that was already under way when the canvas first painted (a running conversation
  // opened, or a send right as the panel appeared) lights it then.
  useEffect(() => {
    if (phase !== 'waiting' || !ready || look.on) return;
    const frame = requestAnimationFrame(() => {
      setLook(LIT);
      setFlowing(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [phase, ready, look.on]);

  useEffect(() => {
    if (!look.on || !look.writing) return;
    const timer = setTimeout(
      () => setLook({ on: false, writing: true, fade: 'exit' }),
      GLOW_TIMING.hue * 1000,
    );
    return () => clearTimeout(timer);
  }, [look.on, look.writing]);

  // The field rests once its fade has finished, ready to light again from the start of a bloom.
  useEffect(() => {
    if (look.on || !flowing) return;
    const seconds = reduced ? GLOW_TIMING.quick : GLOW_TIMING[look.fade];
    const timer = setTimeout(() => {
      setFlowing(false);
      setLook(DARK);
    }, seconds * 1000);
    return () => clearTimeout(timer);
  }, [look.on, look.fade, flowing, reduced]);

  const mounted = WEBGL2 && (flowing || look.on || phase === 'waiting' || phase === 'answering');
  if (!mounted && ready) setReady(false);

  return (
    <div
      aria-hidden
      className="waiting-glow"
      data-on={look.on || undefined}
      data-writing={look.writing || undefined}
      data-fade={reduced ? 'quick' : look.fade}
    >
      {mounted && (
        <Suspense fallback={null}>
          <GlowField active={flowing} on={look.on} entry={!reduced} onPainted={markReady} />
        </Suspense>
      )}
    </div>
  );
}
