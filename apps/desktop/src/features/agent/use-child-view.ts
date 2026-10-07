import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Which subagent's conversation covers the open task, if any. `scope` is the task on screen:
 * leaving it (another task, history, a new chat) closes the drill-in without a focus return.
 * A newly arrived request of the task closes it the same way: the drill-in hides the composer,
 * whose popover is the only place to answer, so the request would otherwise wait unseen. The
 * popover then opens on it and its controls take focus themselves. Closing returns focus to the
 * control that opened it; the parent transcript stays laid out while covered, so its expanded
 * rows and scroll position are still there.
 */
export function useChildView(scope: string | null, requests: readonly { id: string }[]) {
  const [childKey, setChildKey] = useState<string | null>(null);
  const [openScope, setOpenScope] = useState(scope);
  const origin = useRef<HTMLElement | null>(null);
  const returning = useRef(false);
  if (openScope !== scope) {
    setOpenScope(scope);
    setChildKey(null);
  }
  const requestIds = requests.map(({ id }) => id);
  const signature = requestIds.join(',');
  const [seen, setSeen] = useState({ signature, requestIds });
  if (seen.signature !== signature) {
    setSeen({ signature, requestIds });
    if (requestIds.some((id) => !seen.requestIds.includes(id))) setChildKey(null);
  }

  const open = useCallback(
    (key: string, element: HTMLElement) => {
      if (!scope) return;
      origin.current = element;
      returning.current = false;
      setChildKey(key);
    },
    [scope],
  );
  const close = useCallback(() => {
    returning.current = true;
    setChildKey(null);
  }, []);
  /** Closes it without a focus return, for a view that takes its place and focus (a side chat). */
  const dismiss = useCallback(() => {
    returning.current = false;
    setChildKey(null);
  }, []);

  // Runs once the parent transcript is uncovered; its scroll offset never changed, so the focus
  // return must not scroll it.
  useEffect(() => {
    if (childKey || !returning.current) return;
    returning.current = false;
    const element = origin.current;
    origin.current = null;
    if (element?.isConnected) element.focus({ preventScroll: true });
  }, [childKey]);

  return { childKey, open, close, dismiss };
}
