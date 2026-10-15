import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { TaskRun } from '../../../client/agent/task-schema';
import type { AdaptedTurn } from './adapter';
import { promptEntries, samePrompts, type PromptEntry } from './prompt-nav';

/** A turn is being read while it reaches into the top third of the view. */
const READING_BAND = '0px 0px -67% 0px';

function turnElement(viewport: HTMLElement | null, turnId: string): HTMLElement | null {
  return viewport?.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(turnId)}"]`) ?? null;
}

/** The mounted turns by id, gathered in one pass over the viewport. */
function mountedTurns(viewport: HTMLElement): Map<string, HTMLElement> {
  const turns = new Map<string, HTMLElement>();
  for (const element of viewport.querySelectorAll<HTMLElement>('[data-turn-id]'))
    if (element.dataset.turnId) turns.set(element.dataset.turnId, element);
  return turns;
}

/**
 * The message being read: of the mounted turns reaching into the top third of the view, the
 * latest. An IntersectionObserver watches them, so scrolling reads no layout; it observes afresh
 * whenever the mounted turns change (the window extends, a message arrives). In a gap between
 * turns the previous answer stands.
 */
function useReadingTurn(
  viewportRef: RefObject<HTMLDivElement | null>,
  prompts: readonly PromptEntry[],
  firstVisible: number,
): string | null {
  const [reading, setReading] = useState<string | null>(null);
  useEffect(() => {
    const root = viewportRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const order = new Map(prompts.map((entry, index) => [entry.turnId, index]));
    const rank = (turnId: string) => order.get(turnId) ?? -1;
    const crossing = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const turnId = entry.target instanceof HTMLElement ? entry.target.dataset.turnId : null;
          if (!turnId) continue;
          if (entry.isIntersecting) crossing.add(turnId);
          else crossing.delete(turnId);
        }
        let latest: string | null = null;
        for (const turnId of crossing)
          if (latest === null || rank(turnId) > rank(latest)) latest = turnId;
        if (latest !== null) setReading(latest);
      },
      { root, rootMargin: READING_BAND },
    );
    for (const element of root.querySelectorAll<HTMLElement>('[data-turn-id]'))
      if (order.has(element.dataset.turnId ?? '')) observer.observe(element);
    return () => observer.disconnect();
  }, [viewportRef, prompts, firstVisible]);
  return reading;
}

/**
 * The prompt rail's model over a transcript's turns and scrolling: the conversation's user
 * messages, the one being read (`active`), and moving between them.
 *
 * The list is held by value, so a streamed patch that adds no message keeps it, and with it `show`
 * and `step`: the rail does not render again. At the bottom the last message is the current one
 * however short its turn.
 * `show` reveals a message's turn, first extending the window to it (`include`) when it is not
 * mounted yet. `step` moves to the nearest message in its direction whose showing would move the
 * view at all, measured from where the view is headed (`revealDirection`): back from inside a
 * turn's answer reaches that turn's own message first, back past the first mounted turn reaches the
 * messages above it, and on past the last message goes to the bottom. It measures rather than
 * starting from `active`, which can name a message below the view's top: short turns share the top
 * third, and at the bottom the last message is current whatever else the screen shows.
 */
export function usePromptNav({
  turns,
  runs,
  fallback,
  viewportRef,
  firstVisible,
  include,
  reveal,
  revealDirection,
  pin,
  atBottom,
}: {
  turns: AdaptedTurn[];
  runs: TaskRun[];
  /** Names a message that has neither text nor attachments. */
  fallback: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  firstVisible: number;
  include: (index: number) => void;
  reveal: (element: HTMLElement) => void;
  /** Which way showing a mounted turn would move the view: up (-1), down (1), or not at all (0). */
  revealDirection: (element: HTMLElement) => -1 | 0 | 1;
  pin: () => void;
  atBottom: boolean;
}) {
  const nextPrompts = useMemo(() => promptEntries(turns, runs, fallback), [turns, runs, fallback]);
  const [prompts, setPrompts] = useState(nextPrompts);
  if (prompts !== nextPrompts && !samePrompts(prompts, nextPrompts)) setPrompts(nextPrompts);
  const reading = useReadingTurn(viewportRef, prompts, firstVisible);
  const last = prompts.at(-1)?.turnId ?? null;
  const active = atBottom || !prompts.some((entry) => entry.turnId === reading) ? last : reading;
  /** A turn the window is mounting, revealed by the commit that mounts it. */
  const pending = useRef<string | null>(null);

  // Reads the held list, not `turns`: a streamed patch then leaves `show`, and the rail, alone.
  const show = (turnId: string) => {
    const element = turnElement(viewportRef.current, turnId);
    if (element) {
      reveal(element);
      return;
    }
    const entry = prompts.find((item) => item.turnId === turnId);
    if (!entry) return;
    pending.current = turnId;
    include(entry.turnIndex);
  };

  useLayoutEffect(() => {
    const turnId = pending.current;
    if (turnId === null) return;
    pending.current = null;
    const element = turnElement(viewportRef.current, turnId);
    if (element) reveal(element);
  }, [firstVisible, reveal, viewportRef]);

  const step = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const mounted = mountedTurns(viewport);
    // Turns lie in prompt order, so the last message that moves the view up is the nearest above,
    // and the first that moves it down the nearest below.
    const moves = (entry: PromptEntry) => {
      const element = mounted.get(entry.turnId);
      // A message the window has not mounted lies above it: only going back reaches it.
      return element ? revealDirection(element) === direction : direction < 0;
    };
    const target = direction < 0 ? prompts.findLast(moves) : prompts.find(moves);
    if (target) show(target.turnId);
    else if (direction > 0) pin();
  };

  return { prompts, active, show, step };
}
