import { useSyncExternalStore } from 'react';
import type { PromptEntry } from './prompt-nav';

/**
 * What the conversation on screen lets controls outside it do: the composer's message entry steps
 * through and shows its user messages, and the header's find opens its find bar. The transcript
 * that is shown and not covered publishes them; with none (another view, a drill-in or a side chat
 * over the conversation) there are no controls, and those entries hide.
 */
export interface ConversationControls {
  taskId: string;
  /** Every user message of the conversation, mounted or not. */
  prompts: readonly PromptEntry[];
  /** The message being read: the latest reaching into the top third, the last at the bottom. */
  active: string | null;
  /** Moves the view to a message's turn, mounting it first when it is outside the window. */
  show: (turnId: string) => void;
  /** Moves to the previous or next message whose showing would move the view. */
  step: (direction: -1 | 1) => void;
  /** The transcript's scroll viewport, which a message entry may follow and scroll. */
  viewport: HTMLDivElement | null;
  /** Opens the find bar and focuses its field, its last query selected. */
  openFind: () => void;
}

let current: ConversationControls | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Publishes the shown conversation's controls, or withdraws them with null. Only the transcript
 * calls this, and only for itself: a transcript withdraws exactly the controls it published.
 */
export function publishConversationControls(next: ConversationControls | null) {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

/** Withdraws `controls` if they are still the published ones. */
export function withdrawConversationControls(controls: ConversationControls) {
  if (current === controls) publishConversationControls(null);
}

/** The shown conversation's controls; the caller renders again whenever they change. */
export function useConversationControls(): ConversationControls | null {
  return useSyncExternalStore(subscribe, () => current);
}
