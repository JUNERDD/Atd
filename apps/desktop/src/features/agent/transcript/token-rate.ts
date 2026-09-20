import type { Block } from '../../../../electron/agent/transcript-schema';

/**
 * Turn rate, two faces. Settled turns show the provider true output total over worker-measured
 * generation time (`message_start` to `message_end` per assistant message, summed). Live turns
 * cannot know true tokens yet, so they show a character estimate over streamed prose instead;
 * the estimate yields to the true average on settle. Tool execution, permission waits, and TTFT
 * gaps between messages stay out of both denominators; the header's outer "Worked for" keeps
 * the wall duration. Turns without complete durations hide the suffix instead of dividing by
 * wall time. This is a rate input, never billed usage.
 */

/** Minimum span so an instant cached response cannot spike the rate. */
export const RATE_MIN_SPAN_MS = 250;

/** Settled average: provider true total across true generation time. */
export function averageRate(totalTokens: number, elapsedMs: number): number {
  return totalTokens / (Math.max(RATE_MIN_SPAN_MS, elapsedMs) / 1000);
}

/** One decimal under 100 tok/s, integer above; keeps the suffix width stable. */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate < 0) return '0.0';
  return rate < 100 ? rate.toFixed(1) : String(Math.round(rate));
}

const CJK_PATTERN = '\\p{Script=Han}|\\p{Script=Hiragana}|\\p{Script=Katakana}|\\p{Script=Hangul}';
const CJK_GLOBAL = new RegExp(CJK_PATTERN, 'gu');

/**
 * Live character estimate: every CJK char counts 1 token, other chars count 1/4. Length is
 * UTF-16 units, so astral CJK extensions and emoji overcount slightly; acceptable smoothing
 * noise for a live suffix that the settled true total replaces.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const cjk = text.match(CJK_GLOBAL)?.length ?? 0;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

/**
 * Live estimate input: assistant prose plus thinking text. Tool arguments and question
 * titles/options are excluded so tool execution and approval waits add no phantom tokens —
 * the live rate holds its last value while no prose streams.
 */
export function buildLiveText(blocks: Block[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if ((block.kind === 'assistant' || block.kind === 'thinking') && block.text)
      parts.push(block.text);
  }
  return parts.join('\n');
}

type TurnGeneration = { output: number; durationMs?: number };

function usageOf(block: Block): TurnGeneration | null {
  if (block.kind === 'user' || block.kind === 'system') return null;
  const output = block.usage?.output;
  if (typeof output !== 'number' || !Number.isInteger(output) || output < 0) return null;
  const durationMs = block.usage?.durationMs;
  if (durationMs !== undefined && (!Number.isInteger(durationMs) || durationMs < 0)) return null;
  return durationMs === undefined ? { output } : { output, durationMs };
}

/**
 * Provider true total and generation time for a turn, deduped by message. Every block from one
 * message shares its copy, so entries collapse on the composite key; distinct messages that
 * share a millisecond timestamp keep separate entries when their usage differs. Returns null
 * when no message reports output, when the total is zero, or when any output-bearing message
 * lacks a measured duration — the header hides the suffix in those cases. Zero-output messages
 * (errors, aborts) contribute no time so failures cannot dilute the generation rate.
 */
export function sumTurnGeneration(blocks: Block[]): {
  tokens: number;
  durationMs: number;
} | null {
  const byMessage = new Map<string, TurnGeneration>();
  for (const block of blocks) {
    const usage = usageOf(block);
    if (!usage) continue;
    const key = `${block.timestamp}:${usage.output}:${usage.durationMs ?? ''}`;
    byMessage.set(key, usage);
  }
  if (byMessage.size === 0) return null;
  let tokens = 0;
  let durationMs = 0;
  for (const usage of byMessage.values()) {
    tokens += usage.output;
    if (usage.output <= 0) continue;
    if (usage.durationMs === undefined) return null;
    durationMs += usage.durationMs;
  }
  if (tokens <= 0) return null;
  return { tokens, durationMs };
}

/**
 * Compaction markers are the only system blocks the projection emits. A turn containing one
 * lost some provider history, so its settled suffix hides instead of claiming a complete total.
 */
export function hasCompactionMarker(blocks: Block[]): boolean {
  return blocks.some((block) => block.kind === 'system');
}
