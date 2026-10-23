import { useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { canAnimate } from '../../lib/spring-timing';

/** Conversation content reveals after a discrete change, without moving its controls or text. */
export function fadeConversationContent(element: HTMLElement, reduced: boolean, from = 0) {
  if (!canAnimate(element)) return null;
  return element.animate(
    { opacity: [from, 1] },
    { duration: reduced ? 100 : 160, easing: 'ease-out' },
  );
}

/**
 * A status or selected request changed while shown. Initial history stays still, and streaming
 * text never restarts the fade. The same node keeps focus, disclosure state and its place.
 */
export function useContentChangeFade<T extends HTMLElement>(identity: string | undefined) {
  const element = useRef<T>(null);
  const previous = useRef(identity);
  const reduced = useReducedMotion() ?? false;
  useLayoutEffect(() => {
    if (previous.current === identity) return;
    previous.current = identity;
    if (!element.current) return;
    // The entrance already reveals the live node, including its newest wording. Consume this
    // change without queuing a second fade for the same content or replaying it afterward.
    if (element.current.closest('[data-conversation-arriving]')) return;
    const animation = fadeConversationContent(element.current, reduced, 0.55);
    return () => animation?.cancel();
  }, [identity, reduced]);
  return element;
}
