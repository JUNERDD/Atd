import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ShaderMount, type PaperShaderElement } from '@paper-design/shaders-react';
import { useReducedMotion } from 'motion/react';
import { useShaderClock } from '../../../components/use-shader-clock';
import { useColorScheme } from '../../../theme/color-scheme';
import { GLOW_PALETTES, GLOW_SHADER, GLOW_TIMING } from './glow-field';
import { useGlowLevel } from './glow-level';
import type { WaitPhase } from './wait-phase';
import './waiting-glow.css';

/** The shell's light runs at 30 frames a second; its slow motion needs no more once it is in. */
const FRAME_MS = 1000 / 30;

/**
 * The entry moves quickly at first, so the field draws every display frame until the bloom has
 * settled, matching the opacity fade around it, and only then drops to `FRAME_MS`.
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
 * reply (`waitPhase`). It blooms out of the composer in the render that sends the message, as a
 * fresh HUD starts with its light: the canvas is already there, painted and dark,
 * for as long as the panel shows the composer, so nothing is set up while the send is under way.
 * The reply's first output turns it cyan and fades it; a wait that ends any other way (stopped,
 * failed, now waiting on the user) fades it the same way. An `unknown` phase, such as a new task's
 * detail still loading after its send, holds whatever shows. Between waits the field rests: its
 * clock stops and the layer is transparent. The layer is decorative: it takes no pointer events
 * and has no accessible content.
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

  return (
    <div
      aria-hidden
      className="waiting-glow"
      data-on={look.on || undefined}
      data-writing={look.writing || undefined}
      data-fade={reduced ? 'quick' : look.fade}
    >
      {WEBGL2 && <GlowField run={flowing && !reduced} entry={!reduced} onPainted={markReady} />}
    </div>
  );
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

/**
 * The field itself, from the start of its time each time `run` turns on; still while it is off.
 * `entry` has the shader bloom the light out of the composer and gather the field over the first
 * `GLOW_TIMING.entry` seconds; the composer's centre is read as each run starts, since the panel
 * may have resized or the composer grown since the last. `onPainted` runs once its first frame is
 * on screen: Paper compiles the shader as it mounts but draws only when its resize observer first
 * reports the canvas's size, during the next frame's rendering, so the frame after that one has
 * painted it.
 */
function GlowField({
  run,
  entry,
  onPainted,
}: {
  run: boolean;
  entry: boolean;
  onPainted: () => void;
}) {
  const scheme = useColorScheme();
  const level = useGlowLevel();
  const ref = useRef<PaperShaderElement>(null);
  const [origin, setOrigin] = useState<[number, number]>(BOTTOM_CENTRE);
  useLayoutEffect(() => {
    if (run && ref.current) setOrigin(composerCentre(ref.current));
  }, [run]);
  const uniforms = useMemo(
    () => ({
      u_palette: GLOW_PALETTES[scheme].map((rgb) => [...rgb]),
      u_entry: entry ? 1 : 0,
      u_origin: origin,
      u_level: level,
    }),
    [scheme, entry, origin, level],
  );
  useShaderClock(ref, 0, run, FRAME_MS, ENTRY_FULL_RATE_MS);
  useEffect(() => {
    let frame = requestAnimationFrame(function waitForMount() {
      frame = ref.current?.paperShaderMount
        ? requestAnimationFrame(onPainted)
        : requestAnimationFrame(waitForMount);
    });
    return () => cancelAnimationFrame(frame);
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
