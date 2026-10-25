import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { canAnimate } from '../../../lib/spring-timing';
import type { AdaptedTurn } from './adapter';

/** One loaded transcript's arrival history, retained when its older turns unmount. */
export type TurnArrivalHistory = { claim: (id: string) => boolean };

export function createTurnArrivalHistory(initial: readonly string[]): TurnArrivalHistory {
  const seen = new Set(initial);
  return {
    claim(id) {
      const fresh = !seen.has(id);
      seen.add(id);
      return fresh;
    },
  };
}

/** These existing direct children keep their layout, focus and hover ownership. */
const TARGETS =
  '.user-message, .turn-header, .activity-group, [data-turn-content="ready"], .task-files, .message-actions, [data-slot="alert"], section';
const PAGE_ENTRANCE = '.task-stage[data-entering], .task-stage[data-message-flight], [inert]';

function cancelArrivals(active: Map<Element, Animation>) {
  for (const [element, animation] of active) {
    animation.cancel();
    element.removeAttribute('data-conversation-arriving');
  }
  active.clear();
}

/**
 * Arrivals inside a stable turn. No wrapper or transform touches the section: scroll anchors
 * measure its bounds, and the existing direct-child selectors own action visibility. Streaming
 * markdown only fades when it first has content; its tokens keep Streamdown's own reveal.
 */
export function useTurnArrival({
  history,
  id,
  promptArrives,
  live,
  items,
}: {
  history: TurnArrivalHistory;
  id: string;
  /** The first prompt belongs to the page entrance, even if its snapshot arrives later. */
  promptArrives: boolean;
  live: boolean;
  items: AdaptedTurn['items'];
}) {
  const root = useRef<HTMLElement>(null);
  const mounted = useRef(false);
  const firstArrival = useRef<boolean | null>(null);
  const observedLive = useRef(false);
  const seen = useRef(new WeakSet<Element>());
  const seenActivitySteps = useRef(new Set<string>());
  const animations = useRef(new Map<Element, Animation>());
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const active = animations.current;
    return () => {
      cancelArrivals(active);
      // StrictMode replays effects on the same mount. Its replay retains this mount's claimed
      // arrival; a real remount claims the history again and finds that turn already shown.
      mounted.current = false;
      seen.current = new WeakSet();
      seenActivitySteps.current = new Set();
    };
  }, []);

  // A preference change ends existing movement before this commit starts any new short fades.
  useLayoutEffect(() => {
    cancelArrivals(animations.current);
  }, [reduced]);

  const showArrivals = useEffectEvent(() => {
    const section = root.current;
    if (!section) return;
    const initial = !mounted.current;
    if (firstArrival.current === null) firstArrival.current = history.claim(id);
    if (live) observedLive.current = true;
    // Lazy notices fetched for settled history remain history even when their DOM arrives later.
    const fresh = initial ? firstArrival.current : firstArrival.current || observedLive.current;
    mounted.current = true;
    let order = 0;
    const activities = new Map(
      items.filter((item) => item.type === 'activity').map((item) => [item.id, item.view]),
    );
    for (const element of section.children) {
      if (!element.matches(TARGETS)) continue;
      const steps = activities.get(element.getAttribute('data-activity-id') ?? '');
      const shownActivity = steps?.some((step) => seenActivitySteps.current.has(step.id));
      // A settled empty thought can disappear and change its group's key. Track every current
      // member even on an already-seen node so that remount cannot replay the remaining work.
      steps?.forEach((step) => seenActivitySteps.current.add(step.id));
      if (seen.current.has(element)) continue;
      seen.current.add(element);
      const prompt = element.matches('.user-message');
      if (
        !fresh ||
        shownActivity ||
        (prompt && !promptArrives) ||
        section.closest(PAGE_ENTRANCE) ||
        // Earlier action bars retain their CSS hover/focus visibility during settlement.
        element.matches('.message-actions[data-reveal]') ||
        !canAnimate(element)
      )
        continue;
      const move = prompt && !reduced;
      const animation = element.animate(
        move ? { opacity: [0, 1], transform: ['translateY(6px)', 'none'] } : { opacity: [0, 1] },
        {
          duration: reduced ? 120 : move ? 220 : 180,
          // Only this arrival batch is staggered. Cap the wait so several streamed blocks never
          // build a playback queue; backwards fill keeps delayed rows from flashing first.
          delay: reduced ? 0 : Math.min(order++ * 40, 80),
          fill: 'backwards',
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      );
      const active = animations.current;
      active.set(element, animation);
      // A status can settle during this entrance. Its live DOM keeps the latest wording while
      // the inner feedback hook defers to this owner instead of stacking another opacity fade.
      element.setAttribute('data-conversation-arriving', '');
      const finish = () => {
        // A cancelled StrictMode replay must not clear its replacement's ownership marker.
        if (active.get(element) !== animation) return;
        active.delete(element);
        element.removeAttribute('data-conversation-arriving');
      };
      void animation.finished.then(finish, finish);
    }
  });

  useLayoutEffect(() => {
    showArrivals();
  });

  // A completion notice can obtain its data in its own component after the turn's commit.
  // Observe only direct children: markdown tokens and expanded details never retrigger this scan.
  useLayoutEffect(() => {
    const section = root.current;
    if (!section) return;
    const observer = new MutationObserver(() => showArrivals());
    observer.observe(section, { childList: true });
    return () => observer.disconnect();
  }, []);

  return root;
}
