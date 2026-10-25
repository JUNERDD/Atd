import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Session {
  ready: boolean;
  release: (() => void) | undefined;
}

/** Owns native suspension around either recorder, including cancellation before its ack arrives. */
export function useRecordingSession(callbacks: {
  start: () => void;
  stop: () => void;
  onCancel?: () => void;
}) {
  const latest = useRef(callbacks);
  const current = useRef<Session | null>(null);
  const [preparing, setPreparing] = useState(false);
  useLayoutEffect(() => {
    latest.current = callbacks;
  });
  const stop = useCallback(() => {
    const session = current.current;
    current.current = null;
    setPreparing(false);
    try {
      latest.current.stop();
    } finally {
      session?.release?.();
    }
  }, []);
  const cancel = useCallback(() => {
    stop();
    latest.current.onCancel?.();
  }, [stop]);
  const start = useCallback(() => {
    if (current.current) return cancel();
    const session: Session = { ready: false, release: undefined };
    current.current = session;
    setPreparing(true);
    void (async () => {
      try {
        const acquire = window.desktop?.beginShortcutRecording;
        const release = acquire ? await acquire() : undefined;
        if (current.current !== session) {
          release?.();
          return;
        }
        session.release = release;
        session.ready = true;
        setPreparing(false);
        latest.current.start();
      } catch (error) {
        if (current.current === session) cancel();
        console.error('Shortcut recording could not start:', error);
      }
    })();
  }, [cancel]);
  const isActive = useCallback(() => current.current?.ready === true, []);
  const isPending = useCallback(() => current.current?.ready === false, []);
  useEffect(
    () => () => {
      const session = current.current;
      current.current = null;
      // The recorder hook owns its own destruction; only the native lease outlives that cleanup.
      session?.release?.();
    },
    [],
  );
  return { start, stop, cancel, isActive, isPending, preparing };
}
