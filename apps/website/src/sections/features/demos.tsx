import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useInView } from '../../lib/use-in-view';
import { createTextEffects, type TextEffects } from '../../motion/text-effects';
import { useDemoSequence, type DemoLoop } from './use-demo-sequence';
import './demos.css';

/** Rows of the task history slide in this far apart (ms); each state label decodes after its row. */
const TASK_STAGGER_MS = 90;
const TASK_STATE_MS = 240;

interface TaskHistoryProps {
  tasks: readonly { title: string; state: string }[];
}

/**
 * A few rows of task history, as the panel lists them. Illustration only: the tile's text says it.
 * The rows slide in one after another when the list arrives, their states decode, and the streaming
 * task's dot pulses while the list is on screen.
 */
export function TaskHistory({ tasks }: TaskHistoryProps) {
  const ref = useRef<HTMLUListElement>(null);
  const live = useInView(ref);
  return (
    <ul
      ref={ref}
      className="feat__tasks"
      aria-hidden="true"
      data-reveal-group=""
      data-reveal-delay="300"
      data-live={live ? '' : undefined}
    >
      {tasks.map((task, index) => (
        <li
          className="feat__task"
          key={task.title}
          data-streaming={index === 1 ? '' : undefined}
          data-reveal="left"
          data-reveal-delay={index * TASK_STAGGER_MS}
        >
          <span className="feat__task-dot" />
          <span className="feat__task-title">{task.title}</span>
          <span
            className="feat__task-state mono-label"
            data-reveal="decode"
            data-reveal-delay={index * TASK_STAGGER_MS + TASK_STATE_MS}
          >
            {task.state}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** From the log's arrival to its first step, and from one result to the next step, in ms. */
const LOG_START_MS = 380;
const LOG_NEXT_MS = 140;
/** How long each step runs before its result arrives: running the tests takes the longest. */
const LOG_RUN_MS = [300, 680, 440, 260];
/** The finished log holds for a while, then clears and streams again, while it is on screen. */
const LOG_LOOP: DemoLoop = { hold: 5200, clear: 420 };

/** The sequence alternates per step: the step appears and runs, then its result arrives. */
function logDelays(count: number): number[] {
  return Array.from({ length: count }, (_, index) => [
    index === 0 ? LOG_START_MS : LOG_NEXT_MS,
    LOG_RUN_MS[index] ?? LOG_RUN_MS[0] ?? 0,
  ]).flat();
}

type StepState = 'pending' | 'running' | 'done';

function stateOf(index: number, step: number): StepState {
  if (step > index * 2 + 1) return 'done';
  if (step > index * 2) return 'running';
  return 'pending';
}

/** Decodes each result as it arrives: results land on even steps, the second, fourth and so on. */
function useResultDecode(ref: RefObject<HTMLElement | null>, step: number): void {
  const effects = useRef<TextEffects | null>(null);
  const last = useRef(step);

  useEffect(() => {
    const instance = createTextEffects();
    effects.current = instance;
    return () => {
      instance.stop();
      effects.current = null;
    };
  }, []);

  useEffect(() => {
    const arrived = step === last.current + 1 && step % 2 === 0;
    last.current = step;
    if (!arrived || !effects.current) return;
    const value = ref.current?.querySelectorAll<HTMLElement>('.feat__log-value')[step / 2 - 1];
    if (value) effects.current.play(value, 'decode', 0);
  }, [ref, step]);
}

interface ToolLogProps {
  steps: readonly { kind: string; target: string; result: string }[];
}

/**
 * A run's steps as the conversation shows them inline: what ran, on what, and how it went. When the
 * log arrives the run streams in: each step appears with a running indicator, and its result decodes
 * in after a beat. While on screen the finished run holds, clears and streams again. Every row is
 * laid out from the start, so streaming never changes the tile's height.
 */
export function ToolLog({ steps }: ToolLogProps) {
  const ref = useRef<HTMLUListElement>(null);
  const delays = useMemo(() => logDelays(steps.length), [steps.length]);
  const { step, clearing, live } = useDemoSequence(ref, delays, LOG_LOOP);
  useResultDecode(ref, step);

  return (
    <ul
      ref={ref}
      className="feat__log"
      aria-hidden="true"
      data-reveal-group=""
      data-live={live ? '' : undefined}
      data-clearing={clearing ? '' : undefined}
    >
      {steps.map((item, index) => (
        <li className="feat__log-step" key={item.kind} data-state={stateOf(index, step)}>
          <span className="feat__log-kind mono-label">{item.kind}</span>
          <span className="feat__log-target">{item.target}</span>
          <span className="feat__log-result">
            <span className="feat__log-value">{item.result}</span>
            <span className="feat__log-run">
              <span />
              <span />
              <span />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
