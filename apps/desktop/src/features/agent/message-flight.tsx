import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import type { ComposerContent } from '../../components/composer-content';
import { canAnimate, smoothSpring } from '../../lib/spring-timing';

/** A new chat's sent message: on its way, landed in the conversation it opened, or refused. */
export interface Flight {
  content: ComposerContent;
  outcome: 'sending' | 'opened' | 'refused';
}

/** The moment's one primary motion: the message travelling to its bubble. */
const FLIGHT = smoothSpring(0.4);
/**
 * The copy dissolves before the new conversation starts appearing. The destination bubble
 * inherits that page's opacity while growing from `BUBBLE_SCALE` on the flight's spring; it
 * must never appear ahead of the page it belongs to.
 */
const HANDOVER_OUT = { duration: 160, easing: 'cubic-bezier(0, 0, 0.2, 1)' };
const BUBBLE_SCALE = 0.86;
/** Under Reduce Motion nothing travels: the copy and the bubble cross-fade where they are. */
const CROSS_FADE = { duration: 200, easing: 'ease-out' };
const CONVERSATION = '.task-stage > .conversation';
const BUBBLE = '.user-message .message-bubble-frame';
const PAGE_ARRIVAL = { delay: 180, duration: 220, easing: 'cubic-bezier(0, 0, 0.2, 1)' };

/** A bubble's first line as a point: its text's left edge, halfway down its first row. */
function bubbleLine(frame: HTMLElement) {
  const text = frame.querySelector<HTMLElement>('.message-bubble') ?? frame;
  const style = getComputedStyle(text);
  const box = text.getBoundingClientRect();
  const row = parseFloat(style.lineHeight) || 24;
  return {
    x: box.left + parseFloat(style.paddingLeft),
    y: box.top + parseFloat(style.paddingTop) + row / 2,
  };
}

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
 * Moves and scales the bubble from the captured draft's first line around its start (`origin`).
 * Opacity belongs to the conversation, so the bubble appears only as its page appears.
 */
function receive(bubble: HTMLElement, dx: number, dy: number, start: number) {
  const line = bubbleLine(bubble);
  const frame = bubble.getBoundingClientRect();
  const origin = `${line.x - frame.left}px ${line.y - frame.top}px`;
  const path = {
    transform: [`translate(${-dx}px, ${-dy}px) scale(${BUBBLE_SCALE})`, 'none'],
    transformOrigin: [origin, origin],
  };
  return run(bubble, path, FLIGHT, start);
}

/**
 * A new chat's sent message on its way from the composer to its turn (`useNewChat`): a still copy
 * of the draft, taken where it showed, over the panel body (`root`) and above the composer, which
 * hides its own text under it in the same commit.
 *
 * It stays inside the unchanged composer while the send is out, then fades in place before the
 * surface can shrink. The destination bubble travels from that position and appears with the
 * new page as a whole. A real turn that replaces the pending one mid-flight picks up the same
 * motion. A refused send drops the copy
 * out immediately as the composer shows its unchanged draft again. Under Reduce Motion the copy
 * and the bubble cross-fade in place. `onSourceHidden` releases the composer after the draft fades;
 * `onDone` ends the handoff once the bubble has landed.
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
  const { content, outcome } = flight;

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
    let source: Animation | null = null;
    let start: number | null = null;
    let current: HTMLElement | null = null;
    let currentPage: HTMLElement | null = null;
    let dx = 0;
    let dy = 0;
    let stopped = false;
    const synchronize = () => {
      const page = root.querySelector<HTMLElement>(CONVERSATION);
      const bubble = page?.querySelector<HTMLElement>(BUBBLE);
      if (!page || !bubble) return; // A loading placeholder has no destination yet.
      if (start === null) {
        const origin = root.getBoundingClientRect();
        const target = bubbleLine(bubble);
        dx = target.x - (origin.left + content.line.left);
        dy = target.y - (origin.top + content.line.top + content.line.height / 2);
        start = Number(document.timeline.currentTime ?? 0);
        source = run(copy, { opacity: [1, 0] }, reduced ? CROSS_FADE : HANDOVER_OUT, start);
        animations.push(source);
      }
      if (bubble !== current) {
        current = bubble;
        if (!reduced) animations.push(receive(bubble, dx, dy, start));
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
      if (!source || start === null) return;
      const departure = start;
      void source.finished
        .then(async () => {
          if (stopped) return;
          onSourceHidden();
          if (!reduced) {
            // Keep the persistent copy invisible until the shared flight settles. Destination
            // nodes can be replaced mid-flight, so their cancellation cannot own completion.
            const hold = run(
              copy,
              { opacity: [0, 0] },
              { duration: FLIGHT.duration - HANDOVER_OUT.duration },
              departure + HANDOVER_OUT.duration,
            );
            animations.push(hold);
            await hold.finished;
          }
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
