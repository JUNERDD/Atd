import type { Block } from '../../../client/agent/transcript-schema';

/**
 * Turn token rate: provider output totals over the generation time the service timed from each
 * message's stream (`usage.durationMs`, from its first streamed output to its end), summed over
 * the turn's timed messages. Queueing, prompt processing, tool execution and waits on the user
 * fall outside every timed span, so they cannot dilute the rate. Messages without a time (failed
 * or stopped ones, ones too short to time, sessions from before the service timed them) stay out
 * of both sums: a rate never divides tokens by time that did not produce them, and a turn with no
 * timed message hides the suffix. While a message streams its true count is unknown, so the live
 * rate adds a character estimate of its output over its time so far; the true count replaces it
 * once the message settles. The header's "Worked for" keeps the wall duration. This is a rate
 * input, never billed usage.
 */

/** The shortest span a rate is read from, so a just-started stream cannot spike it. */
const RATE_MIN_SPAN_MS = 250;

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
function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const cjk = text.match(CJK_GLOBAL)?.length ?? 0;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

type MessageBlock = Exclude<Block, { kind: 'user' | 'system' | 'compaction' | 'retry' }>;

function isMessageBlock(block: Block): block is MessageBlock {
  return (
    block.kind === 'assistant' ||
    block.kind === 'thinking' ||
    block.kind === 'tool' ||
    block.kind === 'question'
  );
}

/** What a turn's rate is read from. */
export interface TurnGeneration {
  /** Provider output of the turn's timed messages, and their summed generation time. */
  tokens: number;
  durationMs: number;
  /** The message still streaming, once its first output arrived: its blocks and that time. */
  streaming: { blocks: MessageBlock[]; since: number } | null;
}

/**
 * Collects a turn's timed messages and its streaming one. Every block from one message carries
 * the same usage, so copies collapse on the composite key; distinct messages that share a
 * millisecond timestamp keep separate entries when their usage differs. Cheap enough to run on
 * every patch: the streaming message's text is only read when a rate is taken (`turnRate`).
 */
export function measureTurn(blocks: readonly Block[]): TurnGeneration {
  const timed = new Map<string, { output: number; durationMs: number }>();
  const streaming: MessageBlock[] = [];
  let since = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    if (!isMessageBlock(block)) continue;
    const { usage } = block;
    if (usage) {
      if (usage.durationMs !== undefined && usage.output > 0)
        timed.set(`${block.timestamp}:${usage.output}:${usage.durationMs}`, {
          output: usage.output,
          durationMs: usage.durationMs,
        });
      continue;
    }
    if (block.firstTokenAt === undefined) continue;
    streaming.push(block);
    since = Math.min(since, block.firstTokenAt);
  }
  let tokens = 0;
  let durationMs = 0;
  for (const message of timed.values()) {
    tokens += message.output;
    durationMs += message.durationMs;
  }
  return { tokens, durationMs, streaming: streaming.length ? { blocks: streaming, since } : null };
}

/** The output a streaming block has generated so far: prose, thinking or tool call arguments. */
function streamedText(block: MessageBlock): string {
  switch (block.kind) {
    case 'assistant':
    case 'thinking':
      return block.text;
    case 'tool':
      return JSON.stringify(block.args);
    case 'question':
      return [block.title, ...block.options].join('\n');
  }
}

/**
 * The turn's average rate in tok/s: timed tokens over timed generation, plus, when `now` is
 * given, the streaming message's estimate over its time so far. Null while there is nothing to
 * read or the span is still under `RATE_MIN_SPAN_MS`.
 */
export function turnRate(generation: TurnGeneration, now?: number): number | null {
  let { tokens, durationMs } = generation;
  const { streaming } = generation;
  if (streaming && now !== undefined) {
    tokens += estimateTokens(streaming.blocks.map(streamedText).join('\n'));
    durationMs += Math.max(0, now - streaming.since);
  }
  if (tokens <= 0 || durationMs < RATE_MIN_SPAN_MS) return null;
  return tokens / (durationMs / 1000);
}
