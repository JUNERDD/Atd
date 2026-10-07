import type { AssistantUsage, Block } from '../../../client/agent/transcript-schema';

/** A turn's provider-reported usage, summed over its assistant messages. `cost` is USD. */
export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

function usageOf(block: Block): AssistantUsage | undefined {
  if (
    block.kind === 'user' ||
    block.kind === 'system' ||
    block.kind === 'compaction' ||
    block.kind === 'retry'
  )
    return;
  return block.usage;
}

/**
 * Sums the usage of a turn's messages. Every block of one message carries the same copy, so
 * copies collapse on the message timestamp plus the figures themselves; distinct messages that
 * share a millisecond keep separate entries when their usage differs. Null when no message
 * reports input usage (still streaming, or projected before the service sent it), so the header
 * shows no detail rather than zeros.
 */
export function sumTurnUsage(blocks: readonly Block[]): TurnUsage | null {
  const byMessage = new Map<string, TurnUsage>();
  for (const block of blocks) {
    const usage = usageOf(block);
    if (usage?.input === undefined) continue;
    const entry: TurnUsage = {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      cost: usage.cost ?? 0,
    };
    const key = [block.timestamp, ...Object.values(entry)].join(':');
    byMessage.set(key, entry);
  }
  if (byMessage.size === 0) return null;
  const total: TurnUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const entry of byMessage.values()) {
    total.input += entry.input;
    total.output += entry.output;
    total.cacheRead += entry.cacheRead;
    total.cacheWrite += entry.cacheWrite;
    total.cost += entry.cost;
  }
  return total;
}
