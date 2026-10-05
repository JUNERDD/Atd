import type { MemoryEntry, MemoryReadInput, MemorySearchInput } from '@atd/agent-contracts';
import type { Logger } from '../../logging.js';
import { logMemoryEvents, MemoryAuthority } from '../../memory/index.js';

/** Entries `memory.search` answers when the app names no limit. */
const DEFAULT_LIMIT = 10;

/**
 * `memory.read` and `memory.search` over the service's one memory authority (memory/authority.ts),
 * the store the agent's memory tools and the Memory settings read. `memory.write` has no entry
 * point there: the authority only edits or removes existing entries, and adding goes through
 * Hermes' own tools inside a run, so it is answered as not implemented (see the broker).
 */
export async function memoryEntries(agentDir: string, log: Logger): Promise<MemoryEntry[]> {
  const authority = await MemoryAuthority.authorityFor(agentDir, logMemoryEvents(log));
  // The contract bounds an entry to 20000 characters; a longer one is not handed to apps.
  return (await authority.list()).filter((entry) => entry.content.length <= 20_000);
}

export async function memoryRead(agentDir: string, log: Logger, input: MemoryReadInput) {
  const entries = await memoryEntries(agentDir, log);
  return {
    entries: entries
      .filter((entry) => !input.target || entry.target === input.target)
      .slice(0, 200),
  };
}

/**
 * Entries containing the query's words, those matching more words first. The memory store keeps
 * a few hundred short entries, so a scan answers as the agent's `memory_search` would.
 */
export async function memorySearch(agentDir: string, log: Logger, input: MemorySearchInput) {
  const words = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = (await memoryEntries(agentDir, log))
    .map((entry) => {
      const text = entry.content.toLowerCase();
      return { entry, score: words.filter((word) => text.includes(word)).length };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return { entries: scored.slice(0, input.limit ?? DEFAULT_LIMIT).map((item) => item.entry) };
}
