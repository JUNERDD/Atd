import { useCallback, useSyncExternalStore } from 'react';
import type { TaskInput, TaskRun } from '../../client/agent/task-schema';
import type { ModelReference } from '../../client/providers/schema';

/**
 * A message the panel sent that the service has not taken yet: a follow-up, or a new chat's first
 * (`usePageDetail`). Its conversation shows it at once as its last turn (`outgoingTurn`), so a send
 * never waits on the service to look sent; the run the service accepts carries the same identity
 * (`TaskRun.invocationId`) and takes the turn over in place. A refused or unreachable send keeps
 * its message there with the failure where the reply would be (`OutgoingFailure`); it never goes
 * back into the composer, which may hold the next message by then.
 */
export interface OutgoingMessage {
  /** The submit's invocation id, which its accepted run carries as `invocationId`. */
  id: string;
  taskId: string;
  input: TaskInput;
  /** The model its run will use (`panelRunModel`). */
  model: ModelReference | null;
  /** When it was sent, in epoch milliseconds: the turn's clock starts there. */
  sentAt: number;
  /** Why the service did not take it; null while it is on its way. */
  error: string | null;
  /** Sends it again as the same invocation, so a request the service did take runs once. */
  retry: () => void;
  /** Drops it (`discardOutgoing`), and a new chat it would have started with it. */
  discard: () => void;
}

/**
 * Each conversation's latest outgoing message. A later send replaces it; an accepted one stays
 * until then, hidden by its run (`useOutgoingMessage`), since dropping it on acceptance could
 * render a frame before the view lists the run.
 */
const outgoing = new Map<string, OutgoingMessage>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows `message` as its conversation's outgoing message, replacing any earlier one. */
export function putOutgoing(message: OutgoingMessage) {
  outgoing.set(message.taskId, message);
  emit();
}

/** Records how `message` fared, unless its conversation sent another since or discarded it. */
export function settleOutgoing(message: OutgoingMessage) {
  if (outgoing.get(message.taskId)?.id !== message.id) return;
  putOutgoing(message);
}

/** Discards the conversation's outgoing message `id`, unless a later send replaced it. */
export function discardOutgoing(taskId: string, id: string) {
  if (outgoing.get(taskId)?.id !== id) return;
  outgoing.delete(taskId);
  emit();
}

/**
 * The latest local submission, including after its run takes over the optimistic turn. Consumers
 * that react to sending must not mistake acceptance, failure or streamed patches for another send.
 */
export function useOutgoingSubmissionId(taskId: string): string | null {
  const read = useCallback(() => outgoing.get(taskId)?.id ?? null, [taskId]);
  return useSyncExternalStore(subscribe, read);
}

/**
 * Conversation `taskId`'s outgoing message until `runs` list its run, whose turn then shows it;
 * none without a conversation.
 */
export function useOutgoingMessage(
  taskId: string | null,
  runs: readonly TaskRun[],
): OutgoingMessage | undefined {
  const read = useCallback(() => (taskId === null ? undefined : outgoing.get(taskId)), [taskId]);
  const message = useSyncExternalStore(subscribe, read);
  return message && !runs.some((run) => run.invocationId === message.id) ? message : undefined;
}
