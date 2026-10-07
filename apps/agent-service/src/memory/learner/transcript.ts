import type { MemoryUnit } from '@atd/agent-contracts';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { INVOCATION_ENTRY } from '../../invocation-marker.js';
import { escapeTags } from './prompts.js';

/**
 * What a memory review reads (decision R5). The conversation is the branch's `message` entries
 * with role user or assistant, text parts only, so hidden run material (attachments, command
 * templates, references, skills: `custom_message` entries), tool calls and results (recalled
 * memory included), reasoning and compaction summaries never reach it. Three kinds of run are left
 * out too, each up to the next run's invocation marker (invocation-marker.ts): a command run
 * (`source: 'command'`) and an automation's run (`source: 'automation'`), whose messages are saved
 * material and trigger data rather than the user's own words, and a run with memory off
 * (`memory: false`), which the user kept out of memory even when a later run of the task turns
 * memory back on.
 */

/** Each message is clipped to its start and end within this many characters. */
export const MESSAGE_CHARS = 2000;
/** The conversation, filled from the latest message back. */
export const CONVERSATION_CHARS = 24_000;
/** The current memories. */
export const MEMORY_VIEW_CHARS = 8000;
/** Room kept in each budget for the note on what it left out. */
const NOTE_CHARS = 64;
/** A body longer than this is not shown: the review sees a body whole or not at all. */
const VIEW_BODY_CHARS = 2000;
/** A recalled body shorter than this is left in assistant text: short phrases recur by chance. */
const RECALLED_MIN_CHARS = 40;
const CLIP_MARK = '\n[… clipped …]\n';
const MEMORY_CLOSE = '</memory>';

export interface LearningMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface LearningTranscript {
  /** The rendered `<message>` blocks, oldest first. */
  text: string;
  /** Messages rendered. */
  messages: number;
  /** Earlier messages left out by the budget. */
  omitted: number;
}

/** The current memories as the review sees them, and the units whose whole body it saw. */
export interface MemoryView {
  text: string;
  bodies: ReadonlySet<string>;
}

/** The text parts of a message's content; images, reasoning and tool calls carry none. */
export function messageText(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === 'string') return content;
  return content
    .flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
    .join('\n');
}

/** User and assistant text of the runs learning may read (`opensLearnableRun`), in branch order. */
export function learningMessages(branch: readonly SessionEntry[]): LearningMessage[] {
  const messages: LearningMessage[] = [];
  let learnable = true;
  for (const entry of branch) {
    if (entry.type === 'custom' && entry.customType === INVOCATION_ENTRY) {
      learnable = opensLearnableRun(entry.data);
      continue;
    }
    if (!learnable || entry.type !== 'message') continue;
    const { message } = entry;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = messageText(message.content).trim();
    if (text) messages.push({ role: message.role, text });
  }
  return messages;
}

/**
 * Whether learning may read the branch's current run, the one its last invocation marker opened;
 * a branch without a marker counts as one it may.
 */
export function inLearnableRun(branch: readonly SessionEntry[]): boolean {
  const marker = branch.findLast(
    (entry) => entry.type === 'custom' && entry.customType === INVOCATION_ENTRY,
  );
  return marker?.type !== 'custom' || opensLearnableRun(marker.data);
}

/**
 * The conversation within `CONVERSATION_CHARS`, the latest messages first in, rendered oldest
 * first. In assistant text, a verbatim copy of a current memory's body becomes a marker: the
 * agent restating a memory is no evidence for it.
 */
export function learningTranscript(
  branch: readonly SessionEntry[],
  memories: readonly MemoryUnit[],
): LearningTranscript {
  const messages = learningMessages(branch);
  // Memory reaches the model with its body trimmed (framing.ts), so that is what a copy matches.
  const recalled = memories.flatMap((unit) => {
    const body = unit.body.trim();
    return body.length >= RECALLED_MIN_CHARS ? [{ name: unit.name, body }] : [];
  });
  const blocks: string[] = [];
  let size = 0;
  let index = messages.length - 1;
  for (; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) break;
    const text =
      message.role === 'assistant' ? withoutRecalled(message.text, recalled) : message.text;
    const block = `<message role="${message.role}">\n${clip(escapeTags(text), MESSAGE_CHARS)}\n</message>`;
    if (size + block.length + 1 > CONVERSATION_CHARS - NOTE_CHARS) break;
    blocks.push(block);
    size += block.length + 1;
  }
  const omitted = index + 1;
  const rendered = blocks.reverse().join('\n');
  return {
    text: omitted ? `[${omitted} earlier messages left out]\n${rendered}` : rendered,
    messages: blocks.length,
    omitted,
  };
}

/**
 * The enabled units within `MEMORY_VIEW_CHARS`, in the store's order: every unit's name, type,
 * category, activation and description first, then the whole bodies of `core` and `user` units
 * while room is left, since those are what runs and the review rely on most.
 */
export function currentMemoryView(units: readonly MemoryUnit[]): MemoryView {
  const heads: { unit: MemoryUnit; head: string }[] = [];
  let size = 0;
  for (const unit of units) {
    const head = memoryHead(unit);
    if (size + head.length + MEMORY_CLOSE.length + 2 > MEMORY_VIEW_CHARS - NOTE_CHARS) break;
    heads.push({ unit, head });
    size += head.length + MEMORY_CLOSE.length + 2;
  }
  const bodies = new Set<string>();
  for (const { unit } of heads) {
    if (unit.activation !== 'core' && unit.type !== 'user') continue;
    if (unit.body.length > VIEW_BODY_CHARS) continue;
    const cost = memoryBody(unit).length + 1;
    if (size + cost > MEMORY_VIEW_CHARS - NOTE_CHARS) continue;
    bodies.add(unit.name);
    size += cost;
  }
  const blocks = heads.map(({ unit, head }) =>
    [head, ...(bodies.has(unit.name) ? [memoryBody(unit)] : []), MEMORY_CLOSE].join('\n'),
  );
  const left = units.length - heads.length;
  if (left) blocks.push(`[${left} more memories left out]`);
  return { text: blocks.join('\n'), bodies };
}

/** Keeps the start and the end of `text` within `limit` characters. */
export function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const keep = limit - CLIP_MARK.length;
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}${CLIP_MARK}${text.slice(text.length - (keep - head))}`;
}

function memoryHead(unit: MemoryUnit): string {
  const category = unit.category ? ` category="${unit.category}"` : '';
  return `<memory name="${unit.name}" type="${unit.type}"${category} activation="${unit.activation}">
<description>${escapeTags(unit.description)}</description>`;
}

function memoryBody(unit: MemoryUnit): string {
  return `<body>\n${escapeTags(unit.body)}\n</body>`;
}

function withoutRecalled(
  text: string,
  recalled: readonly { name: string; body: string }[],
): string {
  let result = text;
  for (const { name, body } of recalled)
    result = result.replaceAll(body, () => `[recalled memory: ${name}]`);
  return result;
}

/**
 * Whether learning may read the run an invocation marker's `data` opens: not a command or an
 * automation's run and not a run with memory off. A marker without the memory flag counts as
 * memory on, and one whose data is not an object as a user's run.
 */
function opensLearnableRun(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return true;
  const material = 'source' in data && (data.source === 'command' || data.source === 'automation');
  const memoryOff = 'memory' in data && data.memory === false;
  return !material && !memoryOff;
}
