import type { JsonObject, ToolCall } from '@earendil-works/pi-ai';
import {
  estimateTokens,
  formatSize,
  type ContextEditableContent,
  type ContextEditEntryDraft,
  type ExtensionFactory,
  type ProjectedSessionEntry,
} from '@earendil-works/pi-coding-agent';
import { LOAD_SKILL_TOOL, MEMORY_READ_TOOLS, MEMORY_WRITE_TOOLS } from '@atd/agent-contracts';
import { MATERIAL_TAGS } from '../file-loader/material.js';
import { RUN_MATERIAL_TYPE } from '../prompt-context.js';
import { SUBAGENT_TOOL } from '../subagents/tool-contract.js';

/** Share of the effective window from which older context is cleared. */
const PRUNE_AT = 0.6;
/** Clearable context (tool output, call arguments, material), newest first, that stays whole. */
const KEEP_RECENT_TOKENS = 40_000;
/** Smallest saving worth breaking the provider's prompt cache for. */
const MIN_SAVINGS = 20_000;
/** Outputs, arguments and material below this size are left alone; clearing them saves little. */
const MIN_OUTPUT_TOKENS = 1_000;
/** A call argument shorter than this, as JSON, stays as written: paths, patterns, options. */
const MIN_ARGUMENT_CHARS = 400;

export const CLEARED_TOOL_OUTPUT =
  '[Earlier tool output cleared to save context; re-run the tool if needed.]';

/** What stands for a file's text in earlier run material; its name and resource path stay. */
export const CLEARED_FILE_TEXT =
  "[This file's text was cleared to save context; read its resource again, from line 1, if you need it.]";

/**
 * Results and calls that must stay: `load_skill` carries skill instructions that the session's
 * skill re-attach and `load_skill` dedup read from context (skills/session-skills.ts,
 * load-skill-tool.ts), memory searches and writes are small and deliberate, and a subagent result
 * is the only copy of its child's work. A `memory_read` result may be cleared: the model found the
 * memory by name once, in the memory index or a search, and can read it again.
 */
const KEPT_TOOLS = new Set<string>([
  LOAD_SKILL_TOOL,
  ...MEMORY_READ_TOOLS.filter((name) => name !== 'memory_read'),
  ...MEMORY_WRITE_TOOLS,
  SUBAGENT_TOOL,
]);

/** Tools whose large arguments are a file's content, which the file itself still holds. */
const FILE_WRITES = new Set(['write', 'edit']);

const FILE_TEXT = new RegExp(`(<${MATERIAL_TAGS.file}>)[\\s\\S]*?(</${MATERIAL_TAGS.file}>)`, 'g');

type ProjectedMessage = ProjectedSessionEntry['messages'][number];

/** One entry's clearable part: its size, and the entry's content without it (null: it stays). */
interface Clearable {
  /** Estimated tokens of the part, which the protected window counts. */
  tokens: number;
  clear(): { content: ContextEditableContent; saved: number } | null;
}

/**
 * First context layer before compaction (plan P3). At each turn end with context at 60% of the
 * effective window or more, older clearable context beyond the newest ~40k tokens of it is
 * replaced, for later requests only, through Pi's context edits: a large tool result by a short
 * placeholder, a large tool-call argument (a write's content, an edit's text, a long script) by a
 * stub naming its tool, size and file, and the file texts of earlier run material by a stub, the
 * file's name and resource path kept beside it. Images stay with the image budget
 * (harness/image-budget.ts). A stub says where the content is still found (re-running the tool,
 * the written file, the file's resource); the session file and transcript keep all of it. A
 * session whose active tools lack `read` (a run of a command that binds no tools) keeps its
 * material whole, since it could not read a cleared file again. Nothing is cleared unless it saves
 * at least 20k tokens, since every edit invalidates the provider's prompt cache from that point.
 */
export function pruneToolOutputs(): ExtensionFactory {
  return (pi) => {
    pi.on('turn_end', (event, ctx) => {
      const usage = ctx.getContextUsage();
      if (!usage?.tokens || usage.contextWindow <= 0) return undefined;
      if (usage.tokens < PRUNE_AT * usage.contextWindow) return undefined;
      const material = pi.getActiveTools().includes('read');
      const edits = prunableContext(event.context.contextEntries, { material });
      return edits.length ? { entries: [...event.entries, ...edits] } : undefined;
    });
  };
}

/** What a prune pass may clear beside tool output and call arguments. */
export interface PruneScope {
  /** Whether earlier run material's file texts may go, which only a session with `read` reloads. */
  material: boolean;
}

/** Edits for older large tool results, call arguments and material that together save enough. */
export function prunableContext(
  entries: readonly ProjectedSessionEntry[],
  scope: PruneScope,
): ContextEditEntryDraft[] {
  const edits: ContextEditEntryDraft[] = [];
  let recent = 0;
  let savings = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const clearable = entry && clearableOf(entry, scope);
    if (!entry || !clearable) continue;
    // Projected content is already edited, so a cleared part is small and stays as it is.
    if (recent < KEEP_RECENT_TOKENS) {
      recent += clearable.tokens;
      continue;
    }
    const cleared = clearable.clear();
    if (!cleared) continue;
    savings += cleared.saved;
    edits.push({
      type: 'context_edit',
      targetId: entry.sourceEntry.id,
      replacement: { content: cleared.content },
    });
  }
  return savings >= MIN_SAVINGS ? edits.reverse() : [];
}

function clearableOf(entry: ProjectedSessionEntry, scope: PruneScope): Clearable | null {
  const [message, ...rest] = entry.messages;
  const source = entry.sourceEntry;
  if (!message || rest.length) return null;
  if (source.type === 'message' && message.role === 'toolResult') return toolOutput(message);
  if (source.type === 'message' && message.role === 'assistant') return callArguments(message);
  if (source.type === 'custom_message' && source.customType === RUN_MATERIAL_TYPE)
    return scope.material && message.role === 'custom' ? runMaterial(message) : null;
  return null;
}

const PLACEHOLDER_TOKENS = estimateTokens({
  role: 'toolResult',
  toolCallId: '',
  toolName: '',
  content: [{ type: 'text', text: CLEARED_TOOL_OUTPUT }],
  isError: false,
  timestamp: 0,
});

function toolOutput(message: Extract<ProjectedMessage, { role: 'toolResult' }>): Clearable {
  const tokens = estimateTokens(message);
  return {
    tokens,
    clear: () =>
      KEPT_TOOLS.has(message.toolName) || tokens < MIN_OUTPUT_TOKENS
        ? null
        : {
            content: [{ type: 'text', text: CLEARED_TOOL_OUTPUT }],
            saved: tokens - PLACEHOLDER_TOKENS,
          },
  };
}

/** An assistant message's tool calls, whose large arguments may give way to stubs. */
function callArguments(
  message: Extract<ProjectedMessage, { role: 'assistant' }>,
): Clearable | null {
  const calls = message.content.filter((block) => block.type === 'toolCall');
  if (!calls.length) return null;
  const chars = calls.reduce(
    (sum, call) => sum + call.name.length + JSON.stringify(call.arguments).length,
    0,
  );
  return {
    tokens: Math.ceil(chars / 4),
    clear: () => {
      let saved = 0;
      const content = message.content.map((block) => {
        const stubbed = block.type === 'toolCall' ? stubbedArguments(block) : null;
        if (!stubbed) return block;
        saved += stubbed.saved;
        return { ...block, arguments: stubbed.args };
      });
      return saved >= MIN_OUTPUT_TOKENS ? { content, saved } : null;
    },
  };
}

/**
 * A call's arguments with every long one replaced by a stub; small ones (a path, a pattern) stay.
 * The thinking and text beside the calls stay as they are, and a call that carries a reasoning
 * signature (Gemini) stays whole: such a part must be replayed as the model sent it.
 */
function stubbedArguments(call: ToolCall): { args: JsonObject; saved: number } | null {
  if (KEPT_TOOLS.has(call.name) || call.thoughtSignature) return null;
  const file =
    FILE_WRITES.has(call.name) && typeof call.arguments.path === 'string'
      ? call.arguments.path
      : null;
  const args: JsonObject = {};
  let saved = 0;
  for (const [key, value] of Object.entries(call.arguments)) {
    const json = JSON.stringify(value) ?? '';
    if (json.length < MIN_ARGUMENT_CHARS) {
      args[key] = value;
      continue;
    }
    const size = formatSize(Buffer.byteLength(typeof value === 'string' ? value : json));
    const where = file ? ` for ${file}; read the file for its current text` : '';
    const stub = `[Cleared to save context: ${size} of this ${call.name} call's ${key}${where}.]`;
    args[key] = stub;
    saved += Math.ceil((json.length - JSON.stringify(stub).length) / 4);
  }
  return saved > 0 ? { args, saved } : null;
}

/**
 * A run's material (prompt-context.ts), whose file texts may give way to `CLEARED_FILE_TEXT`.
 * Only what lies inside each file's element changes: the notes around it (the file's name and
 * resource path, saved command instructions, folder overviews, references) stay. File text is
 * escaped in the material, so an element ends at its own closing tag.
 */
function runMaterial(message: Extract<ProjectedMessage, { role: 'custom' }>): Clearable {
  const tokens = estimateTokens(message);
  const cleared = (text: string) => text.replace(FILE_TEXT, `$1\n${CLEARED_FILE_TEXT}\n$2`);
  return {
    tokens,
    clear: () => {
      const content =
        typeof message.content === 'string'
          ? cleared(message.content)
          : message.content.map((part) =>
              part.type === 'text' ? { ...part, text: cleared(part.text) } : part,
            );
      const saved = tokens - estimateTokens({ ...message, content });
      return saved >= MIN_OUTPUT_TOKENS ? { content, saved } : null;
    },
  };
}
