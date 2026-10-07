/** Text effects the reveal controller plays in script, for `data-reveal="decode" | "type"`. */
export type TextEffect = 'decode' | 'type';

const TEXT_EFFECTS: ReadonlySet<string> = new Set<TextEffect>(['decode', 'type']);

export function isTextEffect(effect: string | undefined): effect is TextEffect {
  return effect !== undefined && TEXT_EFFECTS.has(effect);
}

interface Job {
  node: Text;
  final: string;
  /** performance.now() at which the effect starts; it holds its first frame until then. */
  start: number;
  duration: number;
  /** The text this job wrote last. Anything else in the node means a render replaced it. */
  written: string;
  render(progress: number, now: number): string;
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
/** Scrambled characters change about 16 times a second, not every frame. */
const NOISE_MS = 60;
const CARET = '▍';

function pick(set: string, seed: number): string {
  return set[Math.abs(Math.imul(seed, 2654435761) >>> 0) % set.length] ?? '';
}

/** A random stand-in of the same class, so monospace labels keep their width while they scramble. */
function noise(char: string, seed: number): string {
  if (char >= 'A' && char <= 'Z') return pick(UPPER, seed);
  if (char >= 'a' && char <= 'z') return pick(LOWER, seed);
  if (char >= '0' && char <= '9') return pick(DIGITS, seed);
  return char;
}

/** Scrambles every letter and digit, then settles them left to right. */
function decode(final: string): Pick<Job, 'duration' | 'render'> {
  const chars = Array.from(final);
  const last = Math.max(1, chars.length - 1);
  return {
    duration: Math.min(1100, 380 + 32 * chars.length),
    render(progress, now) {
      const tick = Math.floor(now / NOISE_MS);
      return chars
        .map((char, index) =>
          progress >= 0.3 + 0.6 * (index / last) ? char : noise(char, tick * 31 + index * 7919),
        )
        .join('');
    },
  };
}

/** Types the text in after a caret. */
function type(final: string): Pick<Job, 'duration' | 'render'> {
  const chars = Array.from(final);
  return {
    duration: Math.min(1600, 160 + 26 * chars.length),
    render(progress) {
      return chars.slice(0, Math.round(progress * chars.length)).join('') + CARET;
    },
  };
}

const MAKERS: Record<TextEffect, (final: string) => Pick<Job, 'duration' | 'render'>> = {
  decode,
  type,
};

export interface TextEffects {
  /** Plays an effect on an element whose only child is one text node; anything else is skipped. */
  play(element: HTMLElement, effect: TextEffect, delayMs: number): void;
  /** Ends every effect at its final text. */
  stop(): void;
}

/**
 * Runs text effects on one shared animation frame loop. An effect rewrites the element's own text
 * node, never replaces it, so React keeps its node; if a render changes the text mid-effect, the
 * effect stops and the new text stands.
 */
export function createTextEffects(): TextEffects {
  const jobs = new Set<Job>();
  let frame = 0;

  const write = (job: Job, text: string) => {
    if (text === job.written) return;
    job.node.nodeValue = text;
    job.written = text;
  };

  const tick = (now: number) => {
    frame = 0;
    for (const job of jobs) {
      if (job.node.nodeValue !== job.written) {
        jobs.delete(job);
        continue;
      }
      const progress = Math.min(1, Math.max(0, (now - job.start) / job.duration));
      write(job, progress >= 1 ? job.final : job.render(progress, now));
      if (progress >= 1) jobs.delete(job);
    }
    if (jobs.size > 0) frame = requestAnimationFrame(tick);
  };

  return {
    play(element, effect, delayMs) {
      const node = element.firstChild;
      if (!(node instanceof Text) || node.nextSibling || !node.nodeValue) return;
      const now = performance.now();
      const job: Job = {
        node,
        final: node.nodeValue,
        start: now + delayMs,
        written: node.nodeValue,
        ...MAKERS[effect](node.nodeValue),
      };
      write(job, job.render(0, now));
      jobs.add(job);
      if (frame === 0) frame = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      for (const job of jobs) {
        if (job.node.nodeValue === job.written) job.node.nodeValue = job.final;
      }
      jobs.clear();
    },
  };
}
