import { readFile } from 'node:fs/promises';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import {
  buildSessionProjection,
  convertToLlm,
  migrateSessionEntries,
  parseSessionEntries,
  serializeConversation,
  type FileEntry,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent';
import { readVerifiedCompletion } from '../computer/completion-message.js';
import { INVOCATION_ENTRY } from '../invocation-marker.js';
import { invocationRunId } from '../transcript.js';

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
  const sessionEntries = entries.filter(isSessionEntry);
  const runs = new Map<string, string | undefined>();
  for (const entry of sessionEntries)
    runs.set(
      entry.id,
      entry.type === 'custom' && entry.customType === INVOCATION_ENTRY
        ? invocationRunId(entry.data)
        : runs.get(entry.parentId ?? ''),
    );
  const projection = buildSessionProjection(sessionEntries);
  // Custom context stays hidden; only validated visible completions are assistant prose.
  // Source ancestry keeps their run association even when compaction omits its marker.
  const turns: string[][] = [];
  let opening = '';
  for (const { sourceEntry, messages } of projection.entries) {
    for (const message of messages) {
      if (message.role === 'custom') {
        const completion = readVerifiedCompletion(message, runs.get(sourceEntry.id));
        if (completion) {
          const text = `[Assistant]: ${completion.text}`;
          const current = turns.at(-1);
          if (current) current.push(text);
          else turns.push([text]);
        }
        continue;
      }
      for (const said of convertToLlm([message])) {
        // System entries are prompt and tool patches, not conversation.
        if (said.role === 'system') continue;
        const kept = said.role === 'assistant' ? withoutThinking(said) : said;
        const text = serializeConversation([kept]);
        const current = turns.at(-1);
        if (said.role === 'user' || !current) {
          if (!turns.length && said.role === 'user') opening = text;
          turns.push([text]);
        } else current.push(text);
      }
    }
  }
  return {
    turns: turns.map((turn) => turn.filter(Boolean).join(SEPARATOR)).filter(Boolean),
    opening,
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
