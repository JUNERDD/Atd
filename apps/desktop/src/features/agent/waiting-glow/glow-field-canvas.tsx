import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ShaderMount, type PaperShaderElement } from '@paper-design/shaders-react';
import { useShaderClock } from '../../../components/use-shader-clock';
import { useColorScheme } from '../../../theme/color-scheme';
import { onWindowVisible } from '../../../window-state';
import { GLOW_SHADER, GLOW_TIMING } from './glow-field';
import { glowColors } from './glow-colors';
import { useGlowLevel } from './glow-level';
import { useGlowViewport } from './glow-viewport';
import { useGlowRetreat } from './glow-retreat';

/** The shell's light runs at 30 frames a second; its slow motion needs no more once it is in. */
const FRAME_MS = 1000 / 30;

/**
 * The entry moves quickly at first, so the field draws every display frame until the bloom has
 * settled, and only then drops to `FRAME_MS`.
 */
const ENTRY_FULL_RATE_MS = (GLOW_TIMING.entry + 0.2) * 1000;

/** Where the bloom starts without a composer to start from: the bottom centre of the light. */
const BOTTOM_CENTRE: [number, number] = [0.5, 0];

/**
 * The field renders at the display's resolution, because its dither (`glow-field.ts`) must land
 * on the pixels the display shows: scaled up, the noise is smoothed away and the falloff bands.
 * This covers the band of a panel about 1,200 points wide on a Retina display.
 */
const MAX_PIXELS = 1_500_000;

/** Upper bound on frames waited for Paper to attach its mount before giving up. */
const MAX_MOUNT_FRAMES = 30;

function isWindowShown(): boolean {
  return !document.hidden && document.documentElement.dataset.windowVisible !== 'false';
}

/**
 * The composer's centre in the light's own units (from its bottom left, as the shader counts), or
 * the bottom centre when the panel shows no composer. The light and the composer are both laid out
 * by the panel body (`App.tsx`), so the composer's glass is found there.
 */
function composerCentre(light: HTMLElement): [number, number] {
  const composer = light.closest('.panel-body')?.querySelector('.composer-surface');
  const box = light.getBoundingClientRect();
  if (!composer || box.width === 0 || box.height === 0) return BOTTOM_CENTRE;
  const glass = composer.getBoundingClientRect();
  return [
    (glass.left + glass.width / 2 - box.left) / box.width,
    (box.bottom - (glass.top + glass.height / 2)) / box.height,
  ];
}

function glowFrame(milliseconds: number, entry: boolean, scheme: 'light' | 'dark') {
  const elapsed = milliseconds / 1000;
  const phase = entry ? elapsed + 1.6 * (1 - Math.exp(-2.5 * elapsed)) : elapsed;
  return { u_elapsed: elapsed, u_phase: phase, u_colors: glowColors(phase, scheme) };
}

/**
 * The field itself, from the start of its time each time `active` turns on; still while it is off.
 * `entry` has the shader bloom the light out of the composer and gather the field over the first
 * `GLOW_TIMING.entry` seconds; the composer's centre is read as each run starts, since the panel
 * may have resized or the composer grown since the last. `onPainted` runs once its first frame is
 * on screen: Paper compiles the shader as it mounts but draws only when its resize observer first
 * reports the canvas's size, during the next frame's rendering, so the frame after that one has
 * painted it.
 */
export function GlowField({
  active,
  on,
  entry,
  onPainted,
}: {
  active: boolean;
  on: boolean;
  entry: boolean;
  onPainted: () => void;
}) {
  const scheme = useColorScheme();
  const level = useGlowLevel();
  const ref = useRef<PaperShaderElement>(null);
  const bandRatio = useGlowViewport(ref, active, MAX_PIXELS);
  const retreat = useGlowRetreat(active, on);
  const clock = useRef(0);
  const bloom = useRef(0);
  const [origin, setOrigin] = useState<[number, number]>(BOTTOM_CENTRE);
  const [retreatTarget, setRetreatTarget] = useState(0);
  useLayoutEffect(() => {
    if (active && ref.current?.parentElement) setOrigin(composerCentre(ref.current.parentElement));
    if (!active) bloom.current = 0;
  }, [active]);
  useLayoutEffect(() => {
    if (active && !on && ref.current?.parentElement) {
      setRetreatTarget(composerCentre(ref.current.parentElement)[1]);
    }
  }, [active, on]);
  // Paper discovers uniform locations at construction. Subsequent frames and appearance updates
  // have one imperative writer, so a React prop effect cannot reset the clock during a morph.
  const [uniforms] = useState(() => ({
    ...glowFrame(0, entry, scheme),
    u_bandRatio: 1,
    u_retreat: 0,
    u_retreatTarget: 0,
    u_entry: entry ? 1 : 0,
    u_origin: BOTTOM_CENTRE,
    u_level: level,
  }));
  const draw = useCallback(
    (element: PaperShaderElement, milliseconds: number) => {
      // Enabling Reduce Motion during an exit freezes the visible coverage for its short fade.
      // Stopping the clock must not repaint a full-height field while that fade is still visible.
      if (active && !on && !entry) return false;
      // An early stop freezes the unfinished bloom, while color and drift keep moving. A wait
      // that resumes during retreat continues from that coverage instead of expanding abruptly.
      if (on) bloom.current += Math.max(0, milliseconds - clock.current);
      clock.current = milliseconds;
      const edge = retreat();
      // setUniforms draws once; following it with setFrame would render the same field twice.
      element.paperShaderMount?.setUniforms({
        ...glowFrame(milliseconds, entry, scheme),
        u_elapsed: bloom.current / 1000,
        u_entry: entry ? 1 : 0,
        u_origin: origin,
        u_level: level,
        u_bandRatio: bandRatio.current,
        u_retreat: entry ? edge.value : 0,
        u_retreatTarget: retreatTarget,
      });
      return edge.moving || (on && entry && bloom.current < ENTRY_FULL_RATE_MS);
    },
    [active, on, entry, scheme, origin, level, bandRatio, retreat, retreatTarget],
  );
  useShaderClock(ref, 0, active && entry, FRAME_MS, ENTRY_FULL_RATE_MS, draw);
  const drawRef = useRef(draw);
  useLayoutEffect(() => {
    drawRef.current = draw;
  });
  useEffect(() => {
    if (ref.current && isWindowShown()) draw(ref.current, clock.current);
  }, [draw]);
  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    let done = false;
    const waitForMount = () => {
      frame = 0;
      if (done || !isWindowShown()) return;
      if (ref.current?.paperShaderMount) {
        done = true;
        drawRef.current(ref.current, clock.current);
        frame = requestAnimationFrame(onPainted);
        return;
      }
      attempts += 1;
      if (attempts < MAX_MOUNT_FRAMES) frame = requestAnimationFrame(waitForMount);
    };
    const syncVisibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!done && isWindowShown()) frame = requestAnimationFrame(waitForMount);
    };
    const unsubscribe = onWindowVisible(syncVisibility);
    document.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
    return () => {
      done = true;
      unsubscribe();
      document.removeEventListener('visibilitychange', syncVisibility);
      cancelAnimationFrame(frame);
    };
  }, [onPainted]);
  return (
    <ShaderMount
      ref={ref}
      className="waiting-glow-canvas"
      fragmentShader={GLOW_SHADER}
      uniforms={uniforms}
      speed={0}
      frame={0}
      minPixelRatio={1}
      maxPixelCount={MAX_PIXELS}
    />
  );
}
