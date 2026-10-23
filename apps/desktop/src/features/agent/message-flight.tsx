import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import type { ComposerContent } from '../../components/composer-content';
import { canAnimate } from '../../lib/spring-timing';

/** A new chat's sent message: on its way, landed in the conversation it opened, or refused. */
export interface Flight {
  content: ComposerContent;
  outcome: 'sending' | 'opened' | 'refused';
}

/** The draft begins dissolving as soon as Send is pressed, independently of the response. */
const HANDOVER_OUT = { duration: 160, easing: 'cubic-bezier(0, 0, 0.2, 1)' };
/** Reduce Motion cross-fades the draft and conversation in place. */
const CROSS_FADE = { duration: 200, easing: 'ease-out' };
const CONVERSATION = '.task-stage > .conversation';
const PAGE_ARRIVAL = { delay: 180, duration: 220, easing: 'cubic-bezier(0, 0, 0.2, 1)' };

/**
 * Runs `keyframes` on `element` from the shared start, so the handoff stays synchronized,
 * holding the first frame through any delay and the last until the flight is over.
 */
function run(
  element: Element,
  keyframes: PropertyIndexedKeyframes,
  timing: KeyframeAnimationOptions,
  start: number,
) {
  const animation = element.animate(keyframes, { ...timing, fill: 'both' });
  animation.startTime = start;
  return animation;
}

/**
 * A new chat's sent message on its way from the composer to its turn (`useNewChat`): a still copy
 * of the draft, taken where it showed, over the panel body (`root`) and above the composer, which
 * hides its own text under it in the same commit.
 *
 * It fades in place as soon as the send starts, before the surface can shrink. The unchanged live
 * draft stays hidden until acceptance or refusal. The conversation fades in as a whole, with its
 * bubble already at its final size and position. A replacement page joins the same fade. A refused
 * send drops the copy immediately as the composer shows its unchanged draft again. `onSourceHidden`
 * releases the composer after the draft fades; `onDone` ends the handoff once the page has appeared.
 */
export function MessageFlight({
  flight,
  root,
  onSourceHidden,
  onDone,
}: {
  flight: Flight;
  root: HTMLElement | null;
  onSourceHidden: () => void;
  onDone: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const host = useRef<HTMLDivElement>(null);
  const source = useRef<Animation | null>(null);
  const { content, outcome } = flight;
  const sourceHidden = useEffectEvent(onSourceHidden);
  const fadeSource = useEffectEvent((element: HTMLDivElement) => {
    if (!canAnimate(element)) {
      sourceHidden();
      return;
    }
    const animation = run(
      element,
      { opacity: [1, 0] },
      reduced ? CROSS_FADE : HANDOVER_OUT,
      Number(document.timeline.currentTime ?? 0),
    );
    source.current = animation;
    let stopped = false;
    void animation.finished.then(
      () => {
        if (!stopped) sourceHidden();
      },
      () => {},
    );
    return () => {
      stopped = true;
      animation.cancel();
      source.current = null;
    };
  });

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    element.style.left = `${content.box.left}px`;
    element.style.top = `${content.box.top}px`;
    element.style.width = `${content.box.width}px`;
    element.style.height = `${content.box.height}px`;
    element.replaceChildren(content.node);
    element.scrollTop = content.scrollTop;
    const scroller = content.node.querySelector('.cm-scroller');
    if (scroller) scroller.scrollLeft = content.scrollLeft;
    return fadeSource(element);
  }, [content]);

  // What happens once the send has an outcome, read with the latest props: the effect below runs
  // it once per outcome, and its cleanup stops whatever it started.
  const settle = useEffectEvent((copy: HTMLDivElement): (() => void) | undefined => {
    if (!root || !canAnimate(copy)) {
      onDone();
      return;
    }
    if (outcome === 'refused') {
      onDone();
      return;
    }
    const animations: Animation[] = [];
    let start: number | null = null;
    let currentPage: HTMLElement | null = null;
    let stopped = false;
    const synchronize = () => {
      const page = root.querySelector<HTMLElement>(CONVERSATION);
      if (!page) return;
      if (start === null) {
        start = Number(document.timeline.currentTime ?? 0);
      }
      if (page !== currentPage) {
        currentPage = page;
        // The bubble, status line and streamed children all inherit one page entrance. Even
        // a replaced page joins the current phase instead of restarting its fade.
        animations.push(run(page, { opacity: [0, 1] }, reduced ? CROSS_FADE : PAGE_ARRIVAL, start));
      }
    };
    const observer = new MutationObserver(() => {
      const waiting = start === null;
      synchronize();
      if (waiting && start !== null) finish();
    });
    const finish = () => {
      if (!source.current || start === null) return;
      const arrival = start;
      void source.current.finished
        .then(async () => {
          if (stopped) return;
          // The source fade has its own clock from Send. Once it is invisible, retain it until
          // the page's clock finishes; acceptance must never replay the draft or its fade.
          const hold = run(
            copy,
            { opacity: [0, 0] },
            {
              duration: reduced ? CROSS_FADE.duration : PAGE_ARRIVAL.delay + PAGE_ARRIVAL.duration,
            },
            arrival,
          );
          animations.push(hold);
          await hold.finished;
          if (!stopped) onDone();
        })
        .catch(() => {});
    };
    // Watch before the first read, including when the task detail has yet to mount.
    observer.observe(root, { childList: true, subtree: true });
    synchronize();
    if (start !== null) finish();
    return () => {
      stopped = true;
      observer.disconnect();
      for (const animation of animations) animation.cancel();
    };
  });
  useLayoutEffect(() => {
    const copy = host.current;
    if (!copy || outcome === 'sending') return;
    return settle(copy);
  }, [outcome]);

  return (
    <div ref={host} className="message-flight" data-expanded={content.expanded} aria-hidden inert />
  );
}
