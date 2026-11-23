// Bakes the brand loader (`src/components/brand-loader.tsx`) into CSS, the drop mask and keyframes,
// and the same keyframes into Swift for the macOS shell's native loading placeholder
// (`WindowLoadingView`), which stands in for the page until it paints.
// The mark's two drops twine around each other. They orbit their shared centre on a circle tilted
// away from the screen, so each in turn passes in front of the other, and pass back through the
// mark between crossings. The drops stay flat; depth shows as scale, and the drop behind fades. The
// mark is point-symmetric, so one orbit ends exactly where it began. Every frame is a plain
// transform and opacity, which the compositor plays without the page's main thread, busy loading
// the window the loader stands in for.
//
// The rhythm is computed, not tuned by eye. The drops speed up away from the mark, rush through the
// middle of the cycle and slow down into the mark again. A loop eases but never stops, so the orbit
// never rests:
// - Its speed is one harmonic of the cycle, slow + (top − slow)·(1 − cos 2πt/T)/2, slowest at the
//   mark. Of all periodic speed curves with the same mean and swing it has the least integrated
//   squared jerk (Wirtinger's inequality): it speeds up and slows down as gently as a loop can.
// - `top` is the fastest at which no point of a drop jumps more than STROBE px between 60Hz frames
//   and each crossing, the span in which the drops overlap and one visibly passes in front of the
//   other, still stays on screen for CROSSING seconds.
// - Each cycle is TURNS turns as the eye counts them: the drops are identical, so the mark looks
//   whole again after every half orbit, and each turn is 180°. `slow` is the fastest at which the
//   mark still holds within LOGO_ARC degrees of rest for LOGO seconds, and there the drops' outline
//   must still move at FLOOR px/s.
//
//   node scripts/brand-loader-motion.mjs          write the stylesheet and the Swift keyframes
//   node scripts/brand-loader-motion.mjs --check  exit 1 when either is stale
//   node scripts/brand-loader-motion.mjs --stats  print the computed rhythm instead
//   node scripts/brand-loader-motion.mjs --curve  print the sampled rhythm curve as JSON
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS_OUTPUT = fileURLToPath(
  new URL('../src/components/brand-loader-motion.css', import.meta.url),
);
const SWIFT_OUTPUT = fileURLToPath(
  new URL(
    '../../macos/Sources/AIShell/Windows/Generated/BrandLoaderMotion.swift',
    import.meta.url,
  ),
);
const SYMBOL = new URL('../../../packages/ui/src/assets/brands/atd/symbol.svg', import.meta.url);

/** The loader draws the 84-unit mark at 32px, centred in a 40px box. */
const PX = 32 / 84;
const BOX = 40;
/** Tilt of the orbit's plane away from the screen: near edge-on, so the drops cross deeply. */
const TILT = 72;
/** Mid-orbit the drops drift apart by this share of their resting distance. */
const SPREAD = 0.14;
/** Scale per unit of depth, and the opacity of a drop at the back of the orbit. */
const DEPTH_SCALE = 0.18;
const BACK_OPACITY = 0.38;
/**
 * Turns per cycle as the eye counts them. The drops are identical, so the mark re-forms every half
 * orbit: each half orbit reads as a turn.
 */
const TURNS = 3;
/**
 * Cycles the animation spans. A cycle of an odd number of half orbits carries each drop to the
 * other's place, so drop `b` plays drop `a`'s keyframes one cycle later, and two cycles bring each
 * back to its own place, so neither jumps at the loop's seam.
 */
const REPEATS = 2;
if (TURNS % 2 === 0) throw new Error('TURNS must be odd for drop b to follow drop a a cycle later.');
/** The farthest a drop's outline may jump in one 60Hz frame: a quarter of its 16px width. */
const STROBE = 4;
/** Seconds each crossing stays on screen even at top speed, about the eye's integration time. */
const CROSSING = 0.1;
/**
 * Degrees either side of rest within which the drops read as the mark, and how long they stay
 * there: about one fixation, the time the eye needs to take in a shape.
 */
const LOGO_ARC = 15;
const LOGO = 0.25;
/** The slowest a drop's outline may move, in px/s: half a 2x display pixel every 60Hz frame. */
const FLOOR = 15;
const SAMPLE = 1 / 240;

/** The drops' radius, read from the master so the loader cannot drift from it. */
function markRadius() {
  const svg = readFileSync(SYMBOL, 'utf8');
  const drops = [...svg.matchAll(/d="M60 60H(\d+)A(\d+) (\d+) 0 1 1 60 (\d+)Z"/g)].map((m) =>
    m.slice(1).map(Number),
  );
  const r = drops[0]?.[1];
  const expected = [
    [60 - r, r, r, 60 - r],
    [60 + r, r, r, 60 + r],
  ];
  if (drops.length !== 2 || JSON.stringify(drops) !== JSON.stringify(expected)) {
    throw new Error('symbol.svg is no longer the two drops this loader is built from.');
  }
  return r;
}
const RADIUS = markRadius();
/** Each drop is a circle whose square corner, its tip, sits at the mark's centre. */
const REST = RADIUS * Math.SQRT2;
const rad = (degrees) => (degrees * Math.PI) / 180;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Both drops at orbit angle `theta`. Drop `a` rests upper left with its tip at the centre; `b` is
 * always its point reflection. Each drop turns with the orbit, so a half-turn swaps them exactly.
 * Positions are px from the mark's centre; `depth` runs from −sin(TILT) at the back to sin(TILT)
 * at the front.
 */
function pose(theta) {
  const angle = rad(theta);
  const distance = REST * (1 + SPREAD * Math.abs(Math.sin(angle)));
  const along = distance * Math.cos(angle);
  const across = distance * Math.sin(angle) * Math.cos(rad(TILT));
  const x = ((across - along) / Math.SQRT2) * PX;
  const y = ((-across - along) / Math.SQRT2) * PX;
  const depth = Math.sin(angle) * Math.sin(rad(TILT));
  const drop = (sign, rotate) => ({
    x: sign * x,
    y: sign * y,
    r: rotate,
    s: 1 + DEPTH_SCALE * sign * depth,
    o: 1 - (1 - BACK_OPACITY) * smooth(Math.max(0, -sign * depth) / Math.sin(rad(TILT))),
  });
  return { a: drop(1, theta), b: drop(-1, theta + 180) };
}

/** The orbit angles, in the first half-turn, at which the drops' circles overlap on screen. */
function crossingWindow() {
  let [enter, leave] = [null, null];
  for (let theta = 0; theta <= 180; theta += 0.01) {
    const { a, b } = pose(theta);
    if (Math.hypot(a.x - b.x, a.y - b.y) < RADIUS * PX * (a.s + b.s)) {
      enter ??= theta;
      leave = theta;
    }
  }
  return [enter, leave];
}

/** The orbit speed (°/s) at cycle phase `u` (0–1): `slow` at the mark, `top` halfway round. */
const speedAt = (u, slow, top) => slow + ((top - slow) * (1 - Math.cos(2 * Math.PI * u))) / 2;

/** The orbit angle at cycle phase `u`, from the mark: the speed's integral, in closed form. */
function orbitAt(u, slow, top) {
  const swing = ((top - slow) * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI))) / 2;
  return (180 * TURNS * (slow * u + swing)) / ((slow + top) / 2);
}

/** The cycle phase at which the speed has covered `share` of its swing from `slow` to `top`. */
const phaseAt = (share) => Math.acos(1 - 2 * share) / (2 * Math.PI);

/** Bisects for the highest value in [low, high] at which `holds` is still true. */
function highest(low, high, holds) {
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (holds(mid)) low = mid;
    else high = mid;
  }
  return low;
}

/** The cycle's length at a `slow` speed under `top`, and how long the mark holds within LOGO_ARC. */
function measure(slow, top) {
  const cycle = (180 * TURNS) / ((slow + top) / 2);
  // The speed is symmetric about the mark: the time to turn LOGO_ARC, doubled.
  const phase = highest(0, 0.5, (u) => orbitAt(u, slow, top) < LOGO_ARC);
  return { cycle, logo: 2 * phase * cycle };
}

/**
 * How fast, in px/s, the fastest point of a drop's outline moves at orbit angle `theta` and orbit
 * speed `speed`: the tip and points around its circle.
 */
function outlineSpeed(theta, speed) {
  const outline = (angle) => {
    const { a } = pose(angle);
    const turn = rad(a.r + 45);
    const tip = [a.x + REST * PX * a.s * Math.cos(turn), a.y + REST * PX * a.s * Math.sin(turn)];
    const rim = Array.from({ length: 8 }, (_, i) => [
      a.x + RADIUS * PX * a.s * Math.cos(turn + (i * Math.PI) / 4),
      a.y + RADIUS * PX * a.s * Math.sin(turn + (i * Math.PI) / 4),
    ]);
    return [tip, ...rim];
  };
  const [before, after] = [outline(theta - 0.01), outline(theta + 0.01)];
  const moved = before.map((p, i) => Math.hypot(after[i][0] - p[0], after[i][1] - p[1]));
  return (Math.max(...moved) / 0.02) * speed;
}

function rhythm() {
  const [enter, leave] = crossingWindow();
  let pxPerDegree = 0;
  for (let theta = 0; theta <= 180; theta += 0.5) {
    pxPerDegree = Math.max(pxPerDegree, outlineSpeed(theta, 1));
  }
  const top = Math.min((STROBE * 60) / pxPerDegree, (leave - enter) / CROSSING);

  // The mark lingers less as the slowest speed rises: the fastest `slow` that still holds it.
  const slow = highest(0, top, (speed) => measure(speed, top).logo >= LOGO);
  const { cycle, logo } = measure(slow, top);
  // How long the speed-up out of the mark takes, from 10% to 90% of the swing (the slowdown into it
  // mirrors it), and how many turns run at 90% of `top` or more.
  const ramp = (phaseAt(0.9) - phaseAt(0.1)) * cycle;
  const fastTurns = (orbitAt(1 - phaseAt(0.9), slow, top) - orbitAt(phaseAt(0.9), slow, top)) / 180;
  const duration = REPEATS * cycle;
  const count = Math.round(duration / SAMPLE);
  const frames = Array.from({ length: count + 1 }, (_, n) => {
    const cycles = (n / count) * REPEATS;
    const repeat = Math.min(Math.floor(cycles), REPEATS - 1);
    const u = cycles - repeat;
    return {
      t: cycles * cycle,
      theta: 180 * TURNS * repeat + orbitAt(u, slow, top),
      speed: speedAt(u, slow, top),
    };
  });
  const slowest = Math.min(...frames.map((frame) => outlineSpeed(frame.theta, frame.speed)));
  if (slowest < FLOOR) throw new Error(`The drops slow to ${slowest}px/s, under ${FLOOR}.`);
  return { enter, leave, top, slow, cycle, duration, logo, ramp, fastTurns, slowest, frames };
}

/** Throws when any frame would carry a drop outside the loader's box. */
function checkBounds(frames) {
  const tip = REST * PX;
  for (const frame of frames) {
    for (const drop of Object.values(pose(frame.theta))) {
      const body = Math.hypot(drop.x, drop.y) + RADIUS * PX * drop.s;
      const angle = rad(drop.r + 45);
      const point = Math.hypot(
        drop.x + tip * drop.s * Math.cos(angle),
        drop.y + tip * drop.s * Math.sin(angle),
      );
      if (Math.max(body, point) > BOX / 2) throw new Error(`A drop leaves the box at ${frame.t}s.`);
    }
  }
}

/**
 * Keeps only the samples linear interpolation needs: a Ramer–Douglas–Peucker pass over time, where
 * a sample matters when dropping it moves any channel by more than that channel's tolerance.
 */
function simplify(frames, channels) {
  const keep = new Set([0, frames.length - 1]);
  const visit = (first, last) => {
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const u = (frames[i].t - frames[first].t) / (frames[last].t - frames[first].t);
      for (const [read, tolerance] of channels) {
        const guess = read(frames[first]) + u * (read(frames[last]) - read(frames[first]));
        const error = Math.abs(guess - read(frames[i])) / tolerance;
        if (error > worst) [worst, index] = [error, i];
      }
    }
    if (worst > 1) {
      keep.add(index);
      visit(first, index);
      visit(index, last);
    }
  };
  visit(0, frames.length - 1);
  return frames.filter((_, i) => keep.has(i));
}

function round(value, places) {
  const result = Number(value.toFixed(places));
  return Object.is(result, -0) ? 0 : result;
}

const transform = (drop) =>
  `translate(${round(drop.x, 3)}px, ${round(drop.y, 3)}px) rotate(${round(drop.r, 2)}deg) scale(${round(drop.s, 4)})`;

/** Drop `a`'s states at the samples linear interpolation needs; drop `b` replays them. */
function dropStates(frames) {
  const states = frames.map((frame) => ({ t: frame.t, ...pose(frame.theta).a }));
  return simplify(states, [
    [(state) => state.x, 0.02],
    [(state) => state.y, 0.02],
    [(state) => state.r, 0.4],
    [(state) => state.s, 0.003],
    [(state) => state.o, 0.01],
  ]);
}

const svgUrl = (viewBox, body) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'>${body}</svg>`,
  )
    .replaceAll('%20', ' ')
    .replaceAll('%2F', '/')
    .replaceAll('%3D', '=')
    .replaceAll('%3A', ':')
    .replaceAll('%2C', ',')}")`;

function stylesheet({ cycle, duration }, states) {
  const [r, d] = [RADIUS, 2 * RADIUS];
  // One drop in its own box: the circle fills it and the tip is its lower-right corner.
  const mask = svgUrl(`0 0 ${d} ${d}`, `<path d='M${d} ${d}H${r}A${r} ${r} 0 1 1 ${d} ${r}Z'/>`);
  const rest = pose(0);
  return `/*
 * Generated by \`scripts/brand-loader-motion.mjs\` from its computed rhythm; edit the script and
 * run \`pnpm --filter @atd/desktop brand-loader-motion\` instead of editing this file. The layout
 * this mask and these keyframes shape lives in \`brand-loader.css\`.
 */
.brand-loader {
  --brand-loader-duration: ${round(duration, 3)}s;
  /* Drop b plays drop a's keyframes one cycle of the rhythm later. */
  --brand-loader-b-delay: ${-round(cycle, 3)}s;
}
.brand-loader-drop {
  width: ${round(d * PX, 3)}px;
  height: ${round(d * PX, 3)}px;
  mask: ${mask} no-repeat center / 100% 100%;
}
/* The resting mark, which Reduce Motion keeps. */
.brand-loader-drop[data-drop='a'] {
  transform: ${transform(rest.a)};
}
.brand-loader-drop[data-drop='b'] {
  transform: ${transform(rest.b)};
}
@keyframes brand-loader-drop {
${states.map((state) => `  ${round((state.t / duration) * 100, 3)}% {\n    transform: ${transform(state)};\n    opacity: ${round(state.o, 3)};\n  }`).join('\n')}
}
`;
}

/** The same keyframes for the shell, already in `swift format` layout. */
function swiftSource({ cycle, duration }, states) {
  const rows = states.map((state) => {
    const values = [state.t / duration, state.x, state.y, state.r, state.s, state.o];
    const places = [5, 3, 3, 2, 4, 3];
    return `    .init(${values.map((value, i) => round(value, places[i])).join(', ')}),`;
  });
  const source = `// Generated by apps/desktop/scripts/brand-loader-motion.mjs from its computed rhythm. Do not edit;
// run \`pnpm --filter @atd/desktop brand-loader-motion\` after changing that script.

/// The brand loader's motion for the native loading placeholder: the keyframes of
/// \`apps/desktop/src/components/brand-loader-motion.css\`, in points from the mark's centre with y
/// pointing down. Drop \`b\` plays drop \`a\`'s keyframes \`bDelay\` seconds later.
enum BrandLoaderMotion {
  struct Keyframe {
    /// Share of \`duration\`, from 0 to 1.
    let time: Double
    let x: Double
    let y: Double
    /// Degrees, clockwise on screen.
    let rotation: Double
    let scale: Double
    let opacity: Double

    init(
      _ time: Double, _ x: Double, _ y: Double, _ rotation: Double, _ scale: Double,
      _ opacity: Double
    ) {
      self.time = time
      self.x = x
      self.y = y
      self.rotation = rotation
      self.scale = scale
      self.opacity = opacity
    }
  }

  /// Seconds the animation runs before it repeats: ${REPEATS} cycles of the rhythm.
  static let duration = ${round(duration, 3)}
  /// One cycle of the rhythm, after which drop \`a\` stands where drop \`b\` stood.
  static let bDelay = ${round(cycle, 3)}
  /// The square each drop fills, its circle and its tip, in points.
  static let dropSize: Double = ${round(2 * RADIUS * PX, 3)}
  /// The mark's square, and the box that leaves room for a drop swelling as it comes forward.
  static let markSize: Double = ${round(84 * PX, 3)}
  static let boxSize: Double = ${BOX}
  /// Drop \`a\`, from the mark at rest.
  static let keyframes: [Keyframe] = [
${rows.join('\n')}
  ]
}
`;
  if (source.split('\n').length > 340) throw new Error('The Swift keyframes outgrow the 350-line limit.');
  return source;
}

const computed = rhythm();
checkBounds(computed.frames);
if (process.argv.includes('--stats')) {
  const { enter, leave, top, slow, cycle, duration, logo, ramp, fastTurns, slowest, frames } =
    computed;
  console.log({
    speed: `${round(slow, 0)}–${round(top, 0)}°/s, one harmonic`,
    cycle: `${round(cycle, 3)}s for ${TURNS} turns, ${round(fastTurns, 2)} of them at 90% of top`,
    ramp: `${round(ramp, 3)}s from 10% to 90% of the swing, each way`,
    animation: `${round(duration, 3)}s, ${REPEATS} cycle${REPEATS > 1 ? 's' : ''}`,
    logo: `±${LOGO_ARC}° for ${round(logo, 3)}s`,
    crossing: `${round(enter, 1)}°–${round(leave, 1)}°, ${round((leave - enter) / top, 3)}s at top`,
    slowest: `${round(slowest, 1)}px/s`,
    keyframes: dropStates(frames).length,
  });
} else if (process.argv.includes('--curve')) {
  const samples = computed.frames.filter((_, i, all) => i % 4 === 0 || i === all.length - 1);
  console.log(
    JSON.stringify(
      samples.map(({ t, theta, speed }) => ({
        t: round(t, 4),
        orbit: round(theta, 2),
        speed: round(speed, 1),
      })),
    ),
  );
} else {
  const states = dropStates(computed.frames);
  const outputs = [
    [CSS_OUTPUT, stylesheet(computed, states)],
    [SWIFT_OUTPUT, swiftSource(computed, states)],
  ];
  if (process.argv.includes('--check')) {
    const normalize = (text) => text.replace(/\s+/g, '');
    for (const [file, text] of outputs) {
      let current = '';
      try {
        current = readFileSync(file, 'utf8');
      } catch {
        // A missing file is stale as well.
      }
      if (normalize(current) !== normalize(text)) {
        console.error(
          `${file} is out of date with its rhythm. Run: pnpm --filter @atd/desktop brand-loader-motion`,
        );
        process.exit(1);
      }
    }
  } else {
    for (const [file, text] of outputs) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    // The repository formatter owns the stylesheet's layout; `format:check` covers it like any other
    // file. The Swift is emitted in its formatter's layout, which `pnpm check:swift` verifies.
    execFileSync('pnpm', ['exec', 'oxfmt', CSS_OUTPUT], { stdio: 'inherit' });
  }
}
