import { useCallback, useEffect, useSyncExternalStore } from 'react';
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

const MAX_OUTGOING = 32;

/**
 * Each conversation's latest pending/failed outgoing message. An accepted entry is evicted once
 * its run appears in `runs`, leaving only its compact submission id in `submissionIds`.
 */
const outgoing = new Map<string, OutgoingMessage>();
const submissionIds = new Map<string, string>();
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

function touch<V>(map: Map<string, V>, key: string, value: V) {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_OUTGOING) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** Shows `message` as its conversation's outgoing message, replacing any earlier one. */
export function putOutgoing(message: OutgoingMessage) {
  touch(outgoing, message.taskId, message);
  touch(submissionIds, message.taskId, message.id);
  emit();
}

/** Records how `message` fared, unless its conversation sent another since or discarded it. */
export function settleOutgoing(message: OutgoingMessage) {
  if (outgoing.get(message.taskId)?.id !== message.id) return;
  putOutgoing(message);
}

/** Evicts the heavyweight `OutgoingMessage` payload once its accepted run appears in `runs`. */
function acceptOutgoing(taskId: string, id: string) {
  if (outgoing.get(taskId)?.id !== id) return;
  outgoing.delete(taskId);
  emit();
}

/** Discards the conversation's outgoing message `id`, unless a later send replaced it. */
export function discardOutgoing(taskId: string, id: string) {
  const droppedMessage = outgoing.get(taskId)?.id === id;
  const droppedId = submissionIds.get(taskId) === id;
  if (!droppedMessage && !droppedId) return;
  if (droppedMessage) outgoing.delete(taskId);
  if (droppedId) submissionIds.delete(taskId);
  emit();
}

/**
 * The latest local submission, including after its run takes over the optimistic turn. Consumers
 * that react to sending must not mistake acceptance, failure or streamed patches for another send.
 */
export function useOutgoingSubmissionId(taskId: string): string | null {
  const read = useCallback(() => submissionIds.get(taskId) ?? null, [taskId]);
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
  const accepted = message !== undefined && runs.some((run) => run.invocationId === message.id);
  useEffect(() => {
    if (accepted && message && taskId !== null) acceptOutgoing(taskId, message.id);
  }, [accepted, message, taskId]);
  return message && !accepted ? message : undefined;
}
