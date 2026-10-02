import {
  estimateTokens,
  type ContextEditEntryDraft,
  type ExtensionFactory,
  type ProjectedSessionEntry,
} from '@earendil-works/pi-coding-agent';
import { LOAD_SKILL_TOOL, MEMORY_TOOLS } from '@atd/agent-contracts';
import { SUBAGENT_TOOL } from '../subagents/tool-contract.js';

/** Share of the effective window from which older tool output is cleared. */
const PRUNE_AT = 0.6;
/** Tool output, newest first, that always stays whole. */
const KEEP_RECENT_TOKENS = 40_000;
/** Smallest saving worth breaking the provider's prompt cache for. */
const MIN_SAVINGS = 20_000;
/** Outputs below this size are left alone; clearing them saves little. */
const MIN_OUTPUT_TOKENS = 1_000;

export const CLEARED_TOOL_OUTPUT =
  '[Earlier tool output cleared to save context; re-run the tool if needed.]';

/**
 * Results that must stay: `load_skill` carries skill instructions that the session's skill
 * re-attach and `load_skill` dedup read from context (skills/session-skills.ts,
 * load-skill-tool.ts), memory results are small and deliberate, and a subagent result is the
 * only copy of its child's work.
 */
const KEPT_TOOLS = new Set<string>([LOAD_SKILL_TOOL, ...MEMORY_TOOLS, SUBAGENT_TOOL]);

/**
 * First context layer before compaction (plan P3). At each turn end with context at 60% of the
 * effective window or more, older large tool results beyond the newest ~40k tokens of tool output
 * are replaced, for later requests only, by a short placeholder through Pi's context edits. The
 * session file and transcript keep the full output. Nothing is cleared unless it saves at least
 * 20k tokens, since every edit invalidates the provider's prompt cache from that point.
 */
export function pruneToolOutputs(): ExtensionFactory {
  return (pi) => {
    pi.on('turn_end', (event, ctx) => {
      const usage = ctx.getContextUsage();
      if (!usage?.tokens || usage.contextWindow <= 0) return undefined;
      if (usage.tokens < PRUNE_AT * usage.contextWindow) return undefined;
      const edits = prunableOutputs(event.context.contextEntries);
      return edits.length ? { entries: [...event.entries, ...edits] } : undefined;
    });
  };
}

/** Edits for the older large tool results, when together they save enough. */
function prunableOutputs(entries: readonly ProjectedSessionEntry[]): ContextEditEntryDraft[] {
  const placeholder = estimateTokens({
    role: 'toolResult',
    toolCallId: '',
    toolName: '',
    content: [{ type: 'text', text: CLEARED_TOOL_OUTPUT }],
    isError: false,
    timestamp: 0,
  });
  const edits: ContextEditEntryDraft[] = [];
  let recent = 0;
  let savings = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const [message, ...rest] = entry?.messages ?? [];
    if (entry?.sourceEntry.type !== 'message' || message?.role !== 'toolResult' || rest.length)
      continue;
    // Projected content is already edited, so a cleared result is small and stays as it is.
    const tokens = estimateTokens(message);
    if (recent < KEEP_RECENT_TOKENS) {
      recent += tokens;
      continue;
    }
    if (KEPT_TOOLS.has(message.toolName) || tokens < MIN_OUTPUT_TOKENS) continue;
    savings += tokens - placeholder;
    edits.push({
      type: 'context_edit',
      targetId: entry.sourceEntry.id,
      replacement: { content: [{ type: 'text', text: CLEARED_TOOL_OUTPUT }] },
    });
  }
  return savings >= MIN_SAVINGS ? edits.reverse() : [];
}
