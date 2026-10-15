import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { TaskRun } from '../../../client/agent/task-schema';
import type { AdaptedTurn } from './adapter';
import { promptEntries, samePrompts, type PromptEntry } from './prompt-nav';
import { revealTop } from './scroll-anchor';

/** A turn is being read while it reaches into the top third of the view. */
const READING_BAND = '0px 0px -67% 0px';

function turnElement(viewport: HTMLElement | null, turnId: string): HTMLElement | null {
  return viewport?.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(turnId)}"]`) ?? null;
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
 * mounted yet; `step` moves to the previous or next message, where back from inside a turn's
 * answer goes to that turn's own message first and on from the last message goes to the bottom.
 */
export function usePromptNav({
  turns,
  runs,
  fallback,
  viewportRef,
  firstVisible,
  include,
  reveal,
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
    if (active === null) return;
    const index = prompts.findIndex((entry) => entry.turnId === active);
    const viewport = viewportRef.current;
    const current = turnElement(viewport, active);
    const inside =
      direction < 0 && viewport && current && viewport.scrollTop > revealTop(viewport, current) + 1;
    const target = prompts[inside ? index : index + direction];
    if (target) show(target.turnId);
    else if (direction > 0) pin();
  };

  return { prompts, active, show, step };
}
