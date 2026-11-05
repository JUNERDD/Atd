import { createContext, use, useId, useMemo, useRef, useState } from 'react';
import type { NextStep, NextStepClick } from '@atd/agent-contracts';
import type { AgentTask, TaskRun } from '../../../client/agent/task-schema';
import { showErrorToast } from '../../../components/toast-store';
import { agentApi } from '../use-agent';

/**
 * What the panel does with a suggestion's prompt. The follow-up actions apply only while `taskId`
 * is the conversation the composer serves; anything else is ignored.
 */
export interface NextStepActions {
  /** Replaces the conversation's draft with `prompt` and focuses the composer at its end. */
  fill: (taskId: string, prompt: string) => void;
  /** Sends `prompt` as the conversation's next message, as a typed message is sent. */
  send: (taskId: string, prompt: string) => void;
  /** Opens a new conversation with `prompt` as its draft; `start` also sends it. */
  newTask: (prompt: string, start: boolean) => void;
}

/** The panel's part of the suggestions: what a click does, and the actions it takes. */
export interface NextStepsHost {
  click: NextStepClick;
  actions: NextStepActions;
}

/**
 * The suggestions the transcript offers under its last turn: run `runId`'s, while that run is the
 * task's last and completed and nothing runs. While they are generated (`pending`) the action bar
 * holds their toggle's place and there are no `items`; once `ready` the card shows them. Whether
 * the card shows (`open`) is the renderer's own choice per run, never saved, so suggestions for a
 * new run always show.
 */
export interface NextStepsOffer extends NextStepsHost {
  taskId: string;
  runId: string;
  status: 'pending' | 'ready';
  /** The cancellation request is waiting for the service's authoritative task state. */
  stopping: boolean;
  stop: () => Promise<void>;
  /** Empty while `pending`. */
  items: NextStep[];
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The card's element id, which the action bar's toggle controls. */
  cardId: string;
  /** The toggle's element id; hiding the card from inside it moves focus there. */
  toggleId: string;
}

/**
 * The offer for `task`'s transcript, or null when nothing is offered: the panel passes no `host`
 * (suggestions are off, or this transcript is not the panel's conversation), the task has no
 * suggestions (pending or ready) for its last run, that run did not complete, or a run is active
 * (`busy`).
 */
export function useNextStepsOffer(
  task: AgentTask,
  busy: boolean,
  host: NextStepsHost | undefined,
): NextStepsOffer | null {
  const [hiddenRun, setHiddenRun] = useState<string | null>(null);
  const [stoppingRuns, setStoppingRuns] = useState<ReadonlySet<string>>(() => new Set());
  const stops = useRef(new Set<string>());
  const cardId = useId();
  const toggleId = useId();
  const suggestions = task.nextSteps;
  const run = task.runs.at(-1);
  const offered =
    host && suggestions && !busy && run?.id === suggestions.runId && run.status === 'completed'
      ? suggestions
      : null;
  return useMemo(() => {
    if (!host || !offered) return null;
    const { runId } = offered;
    return {
      ...host,
      taskId: task.id,
      runId,
      status: offered.status,
      stopping: stoppingRuns.has(runId),
      stop: async () => {
        if (offered.status !== 'pending' || stops.current.has(runId)) return;
        stops.current.add(runId);
        setStoppingRuns(new Set(stops.current));
        try {
          await agentApi().stopNextSteps(task.id, runId);
        } catch (error) {
          showErrorToast(error);
        } finally {
          stops.current.delete(runId);
          // Other conversations may also have a cancellation in flight after switching tasks.
          setStoppingRuns(new Set(stops.current));
        }
      },
      items: offered.status === 'ready' ? offered.items : [],
      open: hiddenRun !== runId,
      setOpen: (open: boolean) => setHiddenRun(open ? null : runId),
      cardId,
      toggleId,
    };
  }, [host, offered, task.id, hiddenRun, stoppingRuns, cardId, toggleId]);
}

/** Each keyed turn provides its own offer; historical turns keep a stable null value. */
export const NextStepsContext = createContext<NextStepsOffer | null>(null);

/** The transcript's offer when it belongs to this turn: the last one, opened by run `run`. */
export function useTurnNextSteps(run: TaskRun | undefined, last: boolean): NextStepsOffer | null {
  const offer = use(NextStepsContext);
  return last && offer && run?.id === offer.runId ? offer : null;
}
