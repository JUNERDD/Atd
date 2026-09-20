import type { Block } from '../../../../electron/agent/transcript-schema';

/**
 * Token-rate counting ported from `pi-tps-status 1.0.5` and `pi-token-speed 0.10.1` (both MIT):
 * sliding 1000ms window with a 250ms minimum span, `estimate=ceil(chars/4)` with each CJK char
 * counting 1, provider final total back-dated across the stream window, tool execution pausing
 * the clock, TTFT from the user message to the first delta, and average (`total/elapsed`) at
 * the end.
 *
 * Electron difference: those plugins render into the `@earendil-works/pi-tui` status bar, which
 * is a no-op under this worker's `json` mode. Here the renderer shows a live character estimate
 * as the TurnHeader suffix while streaming, and the json-mode worker projection (`app-usage`
 * entries plus `message.usage` fallback) replaces it with the provider true total on settle.
 * The suffix is labelled a rate (`tok/s`); it is never billed usage.
 */

/** Sliding window for the live estimate. */
export const RATE_WINDOW_MS = 1000;
/** Minimum span so the first tokens cannot spike the rate. */
export const RATE_MIN_SPAN_MS = 250;

const CJK_PATTERN = '\\p{Script=Han}|\\p{Script=Hiragana}|\\p{Script=Katakana}|\\p{Script=Hangul}';
const CJK_GLOBAL = new RegExp(CJK_PATTERN, 'gu');

/**
 * Character estimate: every CJK char counts 1 token, other chars count 1/4. Length is UTF-16
 * units, so astral CJK extensions and emoji overcount slightly; acceptable smoothing noise.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const cjk = text.match(CJK_GLOBAL)?.length ?? 0;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

/** One live sample; `paused` is the accumulated pause time when the sample was taken. */
export type RateSample = { t: number; tokens: number; paused: number };

/**
 * Keeps samples inside the window plus the newest sample before it as the delta baseline. A
 * lone baseline (mount with existing text, or a single patch) yields no rate until the next
 * growth proves the window — this avoids a remount spike of `total/250ms`.
 */
export function pruneSamples(samples: readonly RateSample[], now: number): RateSample[] {
  const floor = now - RATE_WINDOW_MS;
  let first = 0;
  while (first + 1 < samples.length && (samples[first + 1]?.t ?? 0) < floor) first += 1;
  return samples.slice(first);
}

/**
 * Windowed live rate ending now, with pauses between the baseline and now excluded from the
 * span. Returns null until two samples bracket growth; stalls decay toward zero as now slides
 * past the last sample.
 */
export function windowedRate(
  samples: readonly RateSample[],
  now: number,
  pausedNow: number,
): { rate: number; tokens: number; spanMs: number } | null {
  if (samples.length < 2) return null;
  const last = samples[samples.length - 1];
  const first = samples[0];
  if (!last || !first || last.tokens <= 0) return null;
  const delta = Math.max(0, last.tokens - first.tokens);
  const spanMs = Math.max(RATE_MIN_SPAN_MS, now - pausedNow - (first.t - first.paused));
  return { rate: delta / (spanMs / 1000), tokens: last.tokens, spanMs };
}

/** Settled average: provider true total (or estimate fallback) back-dated across active time. */
export function averageRate(totalTokens: number, elapsedMs: number): number {
  return totalTokens / (Math.max(RATE_MIN_SPAN_MS, elapsedMs) / 1000);
}

/** One decimal under 100 tok/s, integer above; keeps the suffix width stable. */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate < 0) return '0.0';
  return rate < 100 ? rate.toFixed(1) : String(Math.round(rate));
}

/**
 * Model-output text for the live estimate: assistant prose, thinking, tool-call arguments, and
 * question titles/options. User input, tool results, and compaction summaries are excluded.
 */
export function buildRateText(blocks: Block[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case 'assistant':
      case 'thinking':
        if (block.text) parts.push(block.text);
        break;
      case 'tool':
        if (block.args && Object.keys(block.args).length > 0)
          parts.push(JSON.stringify(block.args));
        break;
      case 'question':
        if (block.title) parts.push(block.title);
        if (block.options.length > 0) parts.push(block.options.join('\n'));
        break;
      case 'user':
      case 'system':
        break;
      default: {
        const _exhaustive: never = block;
        void _exhaustive;
      }
    }
  }
  return parts.join('\n');
}

/**
 * Provider true total for a turn, deduped by message timestamp (every block from one message
 * shares its copy). Null while streaming or when unknown — never a false zero.
 */
export function sumTurnUsage(blocks: Block[]): number | null {
  const byMessage = new Map<number, number>();
  for (const block of blocks) {
    if (block.kind === 'user' || block.kind === 'system') continue;
    const output = block.usage?.output;
    if (typeof output !== 'number' || !Number.isInteger(output) || output < 0) continue;
    const prior = byMessage.get(block.timestamp);
    if (prior === undefined || output > prior) byMessage.set(block.timestamp, output);
  }
  if (byMessage.size === 0) return null;
  let total = 0;
  for (const output of byMessage.values()) total += output;
  return total;
}

/**
 * Compaction markers are the only system blocks the projection emits. A turn containing one
 * lost some provider history, so its settled suffix falls back to the character estimate
 * instead of claiming a complete true total.
 */
export function hasCompactionMarker(blocks: Block[]): boolean {
  return blocks.some((block) => block.kind === 'system');
}
