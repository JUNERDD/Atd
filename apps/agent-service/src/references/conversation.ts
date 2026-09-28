import { readFile } from 'node:fs/promises';
import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import {
  buildSessionContext,
  convertToLlm,
  migrateSessionEntries,
  parseSessionEntries,
  serializeConversation,
  type FileEntry,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent';

/** Characters one referenced conversation may add to a run, before the budget trims it. */
export const CONVERSATION_EXCERPT_CHARS = 12000;
/** Characters the opening question keeps when the conversation must be cut. */
const OPENING_CHARS = 2000;
/** Room kept for the omitted-turns marker and separators. */
const MARKER_ROOM = 64;
const SEPARATOR = '\n\n';
const CLIP_MARKER = '\n[… clipped …]\n';

/** A referenced conversation, serialized turn by turn. */
export interface Conversation {
  /** One entry per user turn: the prompt with the replies and tool activity after it. */
  turns: string[];
  /** The first turn's prompt alone, kept when later turns are cut. */
  opening: string;
}

export interface ConversationExcerpt {
  text: string;
  keptTurns: number;
  omittedTurns: number;
}

/**
 * Reads a task's conversation from its session file without writing to it.
 * SessionManager.open is avoided on purpose: it appends a newline to an
 * unterminated last line, writes a header into an empty file and rewrites
 * older-version files, and the referenced task may be running right now.
 */
export async function readConversation(sessionFile: string): Promise<Conversation> {
  const entries = parseSessionEntries(await readFile(sessionFile, 'utf8'));
  if (entries[0]?.type !== 'session') throw new Error('The file is not a Pi session.');
  migrateSessionEntries(entries);
  const { messages } = buildSessionContext(entries.filter(isSessionEntry));
  // Run material (instructions, attachments, references) is injected as
  // hidden custom messages; an excerpt carries what was said, not that
  // material, so a referenced conversation never nests its own references.
  const said = convertToLlm(messages.filter((message) => message.role !== 'custom'));
  const turns: Message[][] = [];
  for (const message of said) {
    // System entries are prompt and tool patches, not conversation.
    if (message.role === 'system') continue;
    const kept = message.role === 'assistant' ? withoutThinking(message) : message;
    const current = turns.at(-1);
    if (message.role === 'user' || !current) turns.push([kept]);
    else current.push(kept);
  }
  const first = turns[0] ?? [];
  return {
    turns: turns.map((turn) => serializeConversation(turn)).filter(Boolean),
    opening: serializeConversation(first.filter((message) => message.role === 'user')),
  };
}

/**
 * Cuts a conversation to `cap` characters: whole when it fits, otherwise the
 * opening question, a marker for the omitted middle, and the newest turns
 * that fit. The newest turn always appears, clipped in the middle if needed.
 */
export function excerptConversation(conversation: Conversation, cap: number): ConversationExcerpt {
  const { turns } = conversation;
  const whole = turns.join(SEPARATOR);
  if (whole.length <= cap) return { text: whole, keptTurns: turns.length, omittedTurns: 0 };
  if (turns.length === 1) return { text: clip(whole, cap), keptTurns: 1, omittedTurns: 0 };
  const opening = clip(conversation.opening, Math.min(OPENING_CHARS, Math.floor(cap / 4)));
  let room = cap - opening.length - MARKER_ROOM;
  const latest: string[] = [];
  for (let index = turns.length - 1; index >= 1; index -= 1) {
    const turn = turns[index] ?? '';
    if (turn.length + SEPARATOR.length <= room) {
      latest.unshift(turn);
      room -= turn.length + SEPARATOR.length;
      continue;
    }
    if (!latest.length) latest.unshift(clip(turn, room - SEPARATOR.length));
    break;
  }
  const omittedTurns = turns.length - 1 - latest.length;
  const marker = omittedTurns
    ? `[… ${omittedTurns} earlier turn${omittedTurns === 1 ? '' : 's'} omitted …]`
    : '';
  return {
    text: [opening, marker, ...latest].filter(Boolean).join(SEPARATOR),
    keptTurns: latest.length + 1,
    omittedTurns,
  };
}

/** Titles and descriptions are user text; labels and hints stay on one line. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Keeps the head and tail of `text` within `max` characters. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= CLIP_MARKER.length) return text.slice(0, Math.max(0, max));
  const head = Math.ceil((max - CLIP_MARKER.length) / 2);
  const tail = max - CLIP_MARKER.length - head;
  return `${text.slice(0, head)}${CLIP_MARKER}${text.slice(text.length - tail)}`;
}

function isSessionEntry(entry: FileEntry): entry is SessionEntry {
  return entry.type !== 'session';
}

/** Reasoning is dropped: the excerpt shows what was said, within a tight budget. */
function withoutThinking(message: AssistantMessage): AssistantMessage {
  return { ...message, content: message.content.filter((block) => block.type !== 'thinking') };
}
