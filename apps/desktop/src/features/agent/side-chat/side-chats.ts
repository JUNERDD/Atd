import { createContext, use } from 'react';
import type { AgentTask, RunStatus } from '../../../client/agent/task-schema';

/**
 * A side chat's state as the HUD shows it, in the order its list sorts: what needs the reader
 * first, then what is working, then what has settled. The keys are the status lists' glyph keys
 * (`progress/status-glyphs.ts`, shared with the subagent list), so both lists draw a state alike.
 */
export const SIDE_CHAT_STATES = [
  'approval',
  'answer',
  'running',
  'failed',
  'interrupted',
  'completed',
] as const;
export type SideChatState = (typeof SIDE_CHAT_STATES)[number];

/** One side chat of the conversation on screen, as the HUD lists it. */
export interface SideChatItem {
  taskId: string;
  title: string;
  state: SideChatState;
  /** When the side chat started; side chats in the same state list newest first. */
  createdAt: string;
  /**
   * The text it ran on (the selection its command read), as one line, so side chats of the same
   * command read apart; empty when its command read none.
   */
  excerpt: string;
}

/** Longest excerpt kept: the list shows one line, which never needs more. */
const MAX_EXCERPT = 200;

/** A side chat's first run's selection on one line; its input text is the rendered command. */
function excerptOf(task: AgentTask): string {
  const flat = (task.runs[0]?.snapshot.input.selection ?? '').replace(/\s+/g, ' ').trim();
  return flat.slice(0, MAX_EXCERPT);
}

/** A side chat's state from its latest run's status; one without a run yet is starting. */
export function sideChatState(status: RunStatus | undefined): SideChatState {
  switch (status) {
    case 'awaiting_confirmation':
      return 'approval';
    case 'awaiting_input':
      return 'answer';
    case undefined:
    case 'queued':
    case 'running':
    case 'stopping':
      return 'running';
    case 'failed':
      return 'failed';
    case 'completed':
      return 'completed';
    case 'stopped':
    case 'cancelled':
    case 'interrupted':
    case 'unknown':
      return 'interrupted';
  }
}

/**
 * The side chats launched from conversation `conversationId`, in the HUD's order: by state, then
 * newest first. Every snapshot task carries its runs' statuses, so the list stays current without
 * holding any side chat's transcript.
 */
export function sideChatItems(tasks: readonly AgentTask[], conversationId: string): SideChatItem[] {
  return tasks
    .filter((task) => task.sideChatOf === conversationId)
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      state: sideChatState(task.runs.at(-1)?.status),
      createdAt: task.createdAt,
      excerpt: excerptOf(task),
    }))
    .sort(
      (a, b) =>
        SIDE_CHAT_STATES.indexOf(a.state) - SIDE_CHAT_STATES.indexOf(b.state) ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

/** What the composer's HUD needs about the side chats of the conversation on screen. */
export interface SideChats {
  /** The conversation's side chats (`sideChatItems`); empty while it has none. */
  items: readonly SideChatItem[];
  /** The side chat shown over the conversation, or null while the conversation itself shows. */
  current: string | null;
  /**
   * Shows side chat `taskId` over the conversation, in place of any other one. Closing it returns
   * focus to `origin` while that is still on the page.
   */
  open: (taskId: string, origin: HTMLElement | null) => void;
}

/**
 * Provided by the task panel around the composer while a conversation is on screen; null in the
 * new chat, history and the other views, where there are no side chats to list.
 */
export const SideChatContext = createContext<SideChats | null>(null);

export function useSideChats(): SideChats | null {
  return use(SideChatContext);
}
