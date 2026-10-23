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
 * The copy hands over to the bubble early in the flight, so it reads as one message changing form:
 * the copy dissolves first, quickly, and the bubble then fades in and grows from `BUBBLE_SCALE` to
 * its size on the flight's spring. Their text differs in size while the bubble grows, so the two
 * barely overlap.
 */
const HANDOVER_OUT = { duration: 160, easing: 'cubic-bezier(0, 0, 0.2, 1)' };
const HANDOVER_IN = { delay: 40, duration: 280, easing: 'cubic-bezier(0, 0, 0.2, 1)' };
const BUBBLE_SCALE = 0.86;
/** Under Reduce Motion nothing travels: the copy and the bubble cross-fade where they are. */
const CROSS_FADE = { duration: 200, easing: 'ease-out' };
const BUBBLE = '.task-stage > .conversation .user-message .message-bubble-frame';
const ARRIVAL = { delay: 180, duration: 220, easing: 'cubic-bezier(0, 0, 0.2, 1)' };
const SUPPORT = [
  '.transcript-turn > :not(.user-message, .message-actions)',
  '.user-message > :not(.message-bubble-frame, .message-actions)',
].join(', ');

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
 * Runs `keyframes` on `element` from the shared start, so the copy and the bubble move as one,
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
 * Animates the bubble into place from where the copy is, along the copy's path, fading in and
 * growing to its size around its first line's start (`origin`), which stays on the copy's first
 * line the whole way.
 */
function receive(bubble: HTMLElement, dx: number, dy: number, reduced: boolean, start: number) {
  const fade = run(bubble, { opacity: [0, 1] }, reduced ? CROSS_FADE : HANDOVER_IN, start);
  if (reduced) return [fade];
  const line = bubbleLine(bubble);
  const frame = bubble.getBoundingClientRect();
  const origin = `${line.x - frame.left}px ${line.y - frame.top}px`;
  const path = {
    transform: [`translate(${-dx}px, ${-dy}px) scale(${BUBBLE_SCALE})`, 'none'],
    transformOrigin: [origin, origin],
  };
  return [fade, run(bubble, path, FLIGHT, start)];
}

/**
 * A new chat's sent message on its way from the composer to its turn (`useNewChat`): a still copy
 * of the draft, taken where it showed, over the panel body (`root`) and above the composer, which
 * hides its own text under it in the same commit.
 *
 * It stays inside the unchanged composer while the send is out. Once the conversation opens it
 * flies to the turn's bubble, which travels the same path, so the copy fades into the bubble on
 * the way: one message changes form instead of one vanishing and another appearing. A real turn
 * that replaces the pending one mid-flight picks up the same motion. A refused send drops the copy
 * out immediately as the composer shows its unchanged draft again. Under Reduce Motion the copy
 * and the bubble cross-fade in place. `onDone` runs once the copy has gone.
 */
export function MessageFlight({
  flight,
  root,
  onDone,
}: {
  flight: Flight;
  root: HTMLElement | null;
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
    const sourceAnimations: Animation[] = [];
    const supported = new WeakSet<Element>();
    let start: number | null = null;
    let current: HTMLElement | null = null;
    let dx = 0;
    let dy = 0;
    let stopped = false;
    const synchronize = () => {
      const bubble = root.querySelector<HTMLElement>(BUBBLE);
      if (!bubble) return; // A loading placeholder has no destination yet.
      if (start === null) {
        const origin = root.getBoundingClientRect();
        const target = bubbleLine(bubble);
        dx = target.x - (origin.left + content.line.left);
        dy = target.y - (origin.top + content.line.top + content.line.height / 2);
        start = Number(document.timeline.currentTime ?? 0);
        sourceAnimations.push(
          run(copy, { opacity: [1, 0] }, reduced ? CROSS_FADE : HANDOVER_OUT, start),
        );
        if (!reduced) {
          sourceAnimations.push(
            run(copy, { transform: ['none', `translate(${dx}px, ${dy}px)`] }, FLIGHT, start),
          );
        }
        animations.push(...sourceAnimations);
      }
      if (bubble !== current) {
        current = bubble;
        animations.push(...receive(bubble, dx, dy, reduced, start));
      }
      const turn = bubble.closest('.transcript-turn');
      for (const element of turn?.querySelectorAll(SUPPORT) ?? []) {
        if (supported.has(element)) continue;
        supported.add(element);
        // New stream content joins the current phase, never a new delayed entrance. In
        // particular, replacing a pending turn cannot hide an already visible status line.
        animations.push(run(element, { opacity: [0, 1] }, reduced ? CROSS_FADE : ARRIVAL, start));
      }
    };
    const observer = new MutationObserver(() => {
      const waiting = start === null;
      synchronize();
      if (waiting && start !== null) finish();
    });
    const finish = () => {
      // Destination nodes can disappear as stream content changes. Only the persistent copy
      // owns completion; a cancelled destination must not leave the stage hidden indefinitely.
      void Promise.all(sourceAnimations.map((animation) => animation.finished)).then(
        () => {
          if (!stopped) onDone();
        },
        () => {},
      );
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
