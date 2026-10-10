/**
 * Renders the film with visible progress: scores the soundtrack, bundles the compositions once,
 * then renders each cut in turn to `out/`. Phases are labeled; on a terminal each redraws one line
 * (bar, percent, frames rendered and encoded, render fps, elapsed, ETA), and anywhere else (CI, a
 * pipe, an agent's shell) a phase prints a plain line at most every 2 s, once it has moved 5% or
 * 15 s have passed.
 *
 *   node scripts/render.ts [en] [zh] [--frames=0-299]
 *
 * With no cut named it renders both. `--frames` takes `N` or `A-B` (inclusive) for a quick preview
 * and writes to the same output path. The encode comes from `render-settings.ts`.
 */
import { spawnSync } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { bundle } from '@remotion/bundler';
import {
  ensureBrowser,
  renderMedia,
  selectComposition,
  type FrameRange,
  type OnBrowserDownload,
} from '@remotion/renderer';
import { ENCODING } from '../render-settings.ts';

const CUTS = {
  en: { id: 'AtdPromo', output: 'out/atd-promo-en.mp4' },
  zh: { id: 'AtdPromoZh', output: 'out/atd-promo-zh.mp4' },
} as const;
type Cut = keyof typeof CUTS;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- Progress lines ----

/** Where a phase stands; `fraction` runs from 0 to 1. */
type Snapshot = { fraction: number; detail?: string };

const LIVE = process.stdout.isTTY === true;
const BAR_WIDTH = 20;
const LIVE_INTERVAL_MS = 100;
// Plain lines: never closer than 2 s, and only after a 5% step or a 15 s heartbeat, so a long
// render logs a few dozen lines rather than one per frame.
const PLAIN_MIN_INTERVAL_MS = 2000;
const PLAIN_HEARTBEAT_MS = 15_000;
const PLAIN_STEP = 0.05;
// A pseudo-terminal created without a size reports 0 columns.
const FALLBACK_COLUMNS = 100;

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m${rest}s`
    : `${minutes}:${rest}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/** Remaining time extrapolated from the pace so far; unknown until there is some progress. */
function eta(elapsedMs: number, fraction: number): string {
  if (fraction <= 0.001 || fraction >= 1) return '--:--';
  return formatDuration((elapsedMs * (1 - fraction)) / fraction);
}

function heading(label: string): void {
  process.stdout.write(`\n== ${label}\n`);
}

/** The phase on screen, so a failure can leave its last state above the error. */
let activePhase: { fail: () => void } | null = null;

/** One phase's progress line. */
function startPhase(label: string) {
  const started = performance.now();
  let lastPrinted = Number.NEGATIVE_INFINITY;
  let lastFraction = Number.NEGATIVE_INFINITY;
  let lastLine = '';
  let finished = false;

  const line = ({ fraction, detail }: Snapshot): string => {
    const clamped = Math.min(1, Math.max(0, fraction));
    const elapsed = performance.now() - started;
    const percent = `${(clamped * 100).toFixed(1).padStart(5)}%`;
    const details = detail === undefined ? '' : `  ${detail}`;
    return `${label} [${'#'.repeat(Math.round(clamped * BAR_WIDTH)).padEnd(BAR_WIDTH, '-')}] ${percent}${details}  ${formatDuration(elapsed)}  ETA ${eta(elapsed, clamped)}`;
  };
  // Clipping keeps the line from wrapping, which would break the in-place redraw.
  const redraw = (text: string): void => {
    const columns = process.stdout.columns || FALLBACK_COLUMNS;
    process.stdout.write(`\r\x1b[2K${text.slice(0, columns - 1)}`);
  };

  const phase = {
    update(snapshot: Snapshot): void {
      if (finished) return;
      const now = performance.now();
      if (LIVE) {
        lastLine = line(snapshot);
        if (now - lastPrinted < LIVE_INTERVAL_MS) return;
        lastPrinted = now;
        redraw(lastLine);
      } else if (
        now - lastPrinted >= PLAIN_MIN_INTERVAL_MS &&
        (snapshot.fraction - lastFraction >= PLAIN_STEP || now - lastPrinted >= PLAIN_HEARTBEAT_MS)
      ) {
        lastPrinted = now;
        lastFraction = snapshot.fraction;
        process.stdout.write(`${line(snapshot)}\n`);
      }
    },
    done(summary: string): void {
      if (finished) return;
      finished = true;
      const text = `${label} done in ${formatDuration(performance.now() - started)}: ${summary}`;
      if (LIVE) redraw(text);
      process.stdout.write(LIVE ? '\n' : `${text}\n`);
    },
    fail(): void {
      if (finished) return;
      finished = true;
      if (LIVE && lastLine !== '') process.stdout.write(`\r\x1b[2K${lastLine}\n`);
    },
  };
  activePhase = phase;
  return phase;
}

// ---- Arguments ----

function parseFrames(value: string | undefined): FrameRange | null {
  if (value === undefined) return null;
  const match = /^(\d+)(?:-(\d+))?$/.exec(value);
  if (match === null) throw new Error(`--frames takes N or A-B, got "${value}"`);
  const start = Number(match[1]);
  if (match[2] === undefined) return start;
  const end = Number(match[2]);
  if (end < start) throw new Error(`--frames range ends before it starts: "${value}"`);
  return [start, end];
}

function isCut(name: string): name is Cut {
  return Object.hasOwn(CUTS, name);
}

function parseCuts(names: string[]): Cut[] {
  if (names.length === 0) return ['en', 'zh'];
  return names.map((name) => {
    if (!isCut(name)) throw new Error(`Unknown cut "${name}"; use en or zh`);
    return name;
  });
}

const USAGE = 'usage: node scripts/render.ts [en] [zh] [--frames=N|A-B]';

/** Reads the command line, or exits with the problem and the usage line instead of a stack. */
function readArguments(): {
  cuts: Cut[];
  frames: string | undefined;
  frameRange: FrameRange | null;
} {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { frames: { type: 'string' } },
    });
    const frameRange = parseFrames(values.frames);
    return { cuts: parseCuts(positionals), frames: values.frames, frameRange };
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    process.exit(2);
  }
}

// ---- Pipeline ----

/** Runs the soundtrack script as its own process, exactly as `pnpm soundtrack` does. */
function scoreSoundtrack(): void {
  heading('scoring soundtrack');
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'soundtrack.ts')], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`Scoring the soundtrack failed (${result.status})`);
}

/** Reports the Chrome Headless Shell download, which happens only on the first render. */
const onBrowserDownload: OnBrowserDownload = () => {
  heading('downloading Chrome Headless Shell');
  const phase = startPhase('browser');
  return {
    version: null,
    onProgress: ({ percent, downloadedBytes, totalSizeInBytes, alreadyAvailable }) => {
      if (alreadyAvailable) return;
      const detail = `${formatBytes(downloadedBytes)} of ${formatBytes(totalSizeInBytes)}`;
      if (percent >= 1) phase.done(detail);
      else phase.update({ fraction: percent, detail });
    },
  };
};

async function renderCut(cut: Cut, serveUrl: string, frameRange: FrameRange | null): Promise<void> {
  const { id, output } = CUTS[cut];
  heading(`rendering ${cut} (${id})`);
  const composition = await selectComposition({ serveUrl, id, logLevel: 'warn' });
  const phase = startPhase(cut);
  let total = 0;
  let renderStarted = performance.now();
  let fps = 0;
  await renderMedia({
    ...ENCODING,
    serveUrl,
    composition,
    frameRange,
    outputLocation: join(root, output),
    logLevel: 'warn',
    onStart: ({ frameCount, resolvedConcurrency }) => {
      total = frameCount;
      renderStarted = performance.now();
      process.stdout.write(
        `${frameCount} frames at ${composition.fps} fps, ${resolvedConcurrency} tabs\n`,
      );
    },
    onProgress: ({ progress, renderedFrames, encodedFrames, renderedDoneIn, stitchStage }) => {
      // Remotion reports once before `onStart` knows the frame count.
      if (total === 0) return;
      // Frozen at the rendering's own duration once it ends, so encoding time does not dilute it.
      const ms = renderedDoneIn ?? performance.now() - renderStarted;
      fps = ms > 0 ? renderedFrames / (ms / 1000) : 0;
      // Once every frame is rendered the encoder finishes, then muxes the soundtrack in; the stage
      // takes the place of the render fps, which no longer changes.
      const pace = renderedFrames >= total ? stitchStage : `${fps.toFixed(1)} fps`;
      phase.update({
        fraction: progress,
        detail: `${renderedFrames}/${total} rendered  ${encodedFrames} encoded  ${pace}`,
      });
    },
  });
  const size = formatBytes(statSync(join(root, output)).size);
  const length = formatDuration((total / composition.fps) * 1000);
  phase.done(`${output} (${length} of film, ${size}, rendered at ${fps.toFixed(1)} fps)`);
}

async function main(): Promise<void> {
  const { cuts, frames, frameRange } = readArguments();
  const started = performance.now();
  process.stdout.write(
    `render: ${cuts.join(', ')}${frameRange === null ? '' : `, frames ${frames}`} (${LIVE ? 'live' : 'plain'} progress)\n`,
  );

  try {
    scoreSoundtrack();
    await ensureBrowser({ onBrowserDownload, logLevel: 'warn' });

    heading('bundling');
    const bundling = startPhase('bundle');
    const serveUrl = await bundle({
      entryPoint: join(root, 'src', 'index.ts'),
      // Remotion reports bundling from 0 to 100.
      onProgress: (percent) => bundling.update({ fraction: percent / 100 }),
      // The bundle is deleted after rendering, so linking `public/` beats copying the audio.
      symlinkPublicDir: true,
    });
    // Removed on any exit: Remotion answers Ctrl-C by closing its browser and calling
    // `process.exit(130)`, which skips `finally` blocks but still runs `exit` listeners.
    process.once('exit', () => rmSync(serveUrl, { recursive: true, force: true }));
    bundling.done('src/index.ts');

    for (const cut of cuts) await renderCut(cut, serveUrl, frameRange);
    process.stdout.write(`\nrender: finished in ${formatDuration(performance.now() - started)}\n`);
  } catch (error) {
    activePhase?.fail();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
