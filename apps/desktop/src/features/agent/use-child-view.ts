import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Which subagent's conversation covers the open task, if any. `scope` is the task on screen:
 * leaving it (another task, history, a new chat) closes the drill-in without a focus return.
 * Closing returns focus to the control that opened it; the parent transcript stays laid out while
 * covered, so its expanded rows and scroll position are still there.
 */
export function useChildView(scope: string | null) {
  const [childKey, setChildKey] = useState<string | null>(null);
  const [openScope, setOpenScope] = useState(scope);
  const origin = useRef<HTMLElement | null>(null);
  const returning = useRef(false);
  if (openScope !== scope) {
    setOpenScope(scope);
    setChildKey(null);
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

  // Runs once the parent transcript is uncovered; its scroll offset never changed, so the focus
  // return must not scroll it.
  useEffect(() => {
    if (childKey || !returning.current) return;
    returning.current = false;
    const element = origin.current;
    origin.current = null;
    if (element?.isConnected) element.focus({ preventScroll: true });
  }, [childKey]);

  return { childKey, open, close };
}
