import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PreparedCommand, TaskDetail } from '../../../client/agent/bridge';
import { runsAsIs } from '../../../client/agent/command-prepare';
import type { CommandDefinition } from '../../../client/agent/command-schema';
import type { PermissionRequest } from '../../../client/agent/permission-schema';
import type { RunStatus, TaskInput } from '../../../client/agent/task-schema';
import type { Block } from '../../../client/agent/transcript-schema';
import { showErrorToast } from '../../../components/toast-store';
import { useSubagentContextValue } from '../transcript/subagent-context';
import type { CommandOpener } from '../transcript/use-offered-commands';
import { agentApi, useTaskDetail } from '../use-agent';
import { useChildView } from '../use-child-view';
import { focusPanelInput } from '../use-panel-window';

const NO_BLOCKS: Block[] = [];
const NO_REQUESTS: PermissionRequest[] = [];

/**
 * What the side chat over the conversation shows: the command's input step, its run starting, or
 * the side chat's own task. `id` names the opening, which every later phase keeps, so a result
 * that arrives after the side chat closed or another opened can tell.
 */
export type SideChatView =
  | { id: number; phase: 'input' | 'starting'; prepared: PreparedCommand }
  | { id: number; phase: 'task'; taskId: string };

/** The side chat of the conversation on screen, as `useSideChat` runs it. */
export type SideChat = ReturnType<typeof useSideChat>;

/** The conversation waits on the user: a request it raised blocks its run. */
function waitsOnUser(status: RunStatus | undefined) {
  return status === 'awaiting_confirmation' || status === 'awaiting_input';
}

/**
 * The side chat a command launched from inside a conversation opens over it, one at a time: the
 * command runs as its own new task (`sideChatOf` the conversation), shown in a layer while the
 * conversation stays mounted under it. `scope` is the conversation on screen: leaving it closes
 * the side chat without a focus return, as does a request the conversation raises (read from its
 * snapshot `status`, since its transcript is not held while covered), so the composer shows it.
 * Closing returns focus to the control that opened the side chat, else to the composer, and
 * `rehold` takes the page's transcript hold back for the conversation. A run that started keeps
 * going when its side chat closes; the conversation's HUD lists it.
 */
export function useSideChat({
  scope,
  status,
  dismissChild,
  start,
  rehold,
}: {
  scope: string | null;
  status: RunStatus | undefined;
  /** Closes the conversation's subagent view without a focus return. */
  dismissChild: () => void;
  /**
   * Submits a new side chat of `conversationId` and resolves with its detail, or null when the
   * panel refused it (a submit in flight). `launched` runs as prepared, on the command's own
   * policy; without it the input step's command runs as the user completed it.
   */
  start: (conversationId: string, launched?: PreparedCommand) => Promise<TaskDetail | null>;
  /** Takes the page's transcript hold back for the conversation, which reloads it. */
  rehold: () => void;
}) {
  const [shown, setShown] = useState<SideChatView | null>(null);
  // The side task's own reload: a start that resolves late moves the page's hold to its new task.
  const [epoch, setEpoch] = useState(0);
  const waiting = waitsOnUser(status);
  const [seen, setSeen] = useState({ scope, waiting });
  if (seen.scope !== scope || seen.waiting !== waiting) {
    setSeen({ scope, waiting });
    if (shown && (seen.scope !== scope || waiting)) {
      setShown(null);
      rehold();
    }
  }
  const taskId = shown?.phase === 'task' ? shown.taskId : null;
  const { detail } = useTaskDetail(taskId, epoch);
  const requests = detail?.requests ?? NO_REQUESTS;
  const child = useChildView(taskId, requests);
  const subagents = useSubagentContextValue(detail?.blocks ?? NO_BLOCKS, requests, child.open);

  /** What shows as of the latest change, which a result compares its own opening with. */
  const current = useRef<SideChatView | null>(null);
  const live = useRef({ scope, start, rehold, dismissChild });
  const origin = useRef<HTMLElement | null>(null);
  const returning = useRef(false);
  const openings = useRef(0);

  function show(next: SideChatView | null) {
    current.current = next;
    setShown(next);
  }
  /** A new opening in place of any other, over the conversation's subagent view. */
  function begin(from: HTMLElement | null) {
    live.current.dismissChild();
    origin.current = from;
    returning.current = false;
    openings.current += 1;
    return openings.current;
  }
  /**
   * Opening `id`'s run started. Closed or replaced meanwhile, it goes on as its own task, and the
   * page takes back its hold for what it shows, which the start moved to the new task.
   */
  function started(id: number, result: TaskDetail) {
    const showing = current.current;
    if (showing?.id === id) show({ id, phase: 'task', taskId: result.task.id });
    else if (showing?.phase === 'task') setEpoch((value) => value + 1);
    else live.current.rehold();
  }

  async function openCommand(command: CommandDefinition, text: string, from: HTMLElement | null) {
    const conversationId = live.current.scope;
    if (!conversationId) return;
    let prepared: PreparedCommand | null = null;
    try {
      prepared = await agentApi().prepareWithText(command.id, text);
    } catch (error) {
      showErrorToast(error);
    }
    // Meant for a conversation no longer on screen.
    if (!prepared || live.current.scope !== conversationId) return;
    const id = begin(from);
    if (!runsAsIs(prepared)) return show({ id, phase: 'input', prepared });
    show({ id, phase: 'starting', prepared });
    let result: TaskDetail | null = null;
    try {
      result = await live.current.start(conversationId, prepared);
    } catch (error) {
      showErrorToast(error);
    }
    // A run that cannot start returns to the input step for repair, as a shortcut run does.
    if (result) started(id, result);
    else if (current.current?.id === id) show({ id, phase: 'input', prepared });
  }
  /** Shows an existing side chat; the one already showing keeps its place, the composer focused. */
  function open(task: string, from: HTMLElement | null) {
    const showing = current.current;
    if (!live.current.scope) return;
    if (showing?.phase === 'task' && showing.taskId === task) {
      requestAnimationFrame(focusPanelInput);
      return;
    }
    show({ id: begin(from), phase: 'task', taskId: task });
  }
  /** The conversation shows again, its hold taken back; `returnFocus` to what opened the side chat. */
  function end(returnFocus: boolean) {
    if (!current.current) return;
    returning.current = returnFocus;
    show(null);
    live.current.rehold();
  }
  const actions = useRef({ openCommand, open, end });
  // Every commit: the callbacks below, and results arriving after it, act on what it shows.
  useLayoutEffect(() => {
    current.current = shown;
    live.current = { scope, start, rehold, dismissChild };
    actions.current = { openCommand, open, end };
  });
  // Stable, so the transcript's memoized turns, the HUD and listeners keep them across renders.
  const runCommand = useCallback<CommandOpener>(
    (command, text, from) => void actions.current.openCommand(command, text, from),
    [],
  );
  const openSideChat = useCallback(
    (task: string, from: HTMLElement | null) => actions.current.open(task, from),
    [],
  );
  const close = useCallback(() => actions.current.end(true), []);
  const dismiss = useCallback(() => actions.current.end(false), []);

  // Runs once the conversation is uncovered; its scroll offset never changed, so the focus
  // return must not scroll it. The composer takes focus when the opener has gone.
  useEffect(() => {
    if (shown || !returning.current) return;
    returning.current = false;
    const element = origin.current;
    origin.current = null;
    if (element?.isConnected) element.focus({ preventScroll: true });
    else requestAnimationFrame(focusPanelInput);
  }, [shown]);

  return {
    view: shown,
    /** The side chat's task while it shows one, which the composer then serves. */
    taskId,
    detail,
    /** The side chat's own subagent view, over it. */
    child,
    subagents,
    runCommand,
    open: openSideChat,
    /** Back: the conversation shows again, and focus returns to what opened the side chat. */
    close,
    /** Closes it without a focus return, for a view that takes focus itself. */
    dismiss,
    setInput: (input: TaskInput) =>
      setShown((view) =>
        view?.phase === 'input' ? { ...view, prepared: { ...view.prepared, input } } : view,
      ),
    /** The input step's Run: the side chat starts in place; a failure rejects for the step. */
    runInput: async () => {
      const view = current.current;
      const conversationId = live.current.scope;
      if (view?.phase !== 'input' || !conversationId) return;
      const result = await live.current.start(conversationId);
      if (result) started(view.id, result);
    },
  };
}
