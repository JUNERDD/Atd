import { forwardRef, useLayoutEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, useComposedRefs, usePresence, usePresenceData } from 'motion/react';

/** One CSS fade owns both the pending send and its page handoff. */
const WelcomePage = forwardRef<HTMLDivElement, { leaving: boolean; children: ReactNode }>(
  function WelcomePage({ leaving, children }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const combinedRef = useComposedRefs(ref, host);
    const [present, safeToRemove] = usePresence();
    const toChat = usePresenceData() === true;

    useLayoutEffect(() => {
      if (present) return;
      const element = host.current;
      // History/apps still replace the welcome immediately. A chat keeps the existing fade,
      // including its current opacity and remaining time, instead of starting an exit animation.
      if (!toChat || !element || typeof element.getAnimations !== 'function') {
        safeToRemove();
        return;
      }
      let stopped = false;
      const pending = element.getAnimations().map((animation) => animation.finished);
      void Promise.allSettled(pending).then(() => {
        if (!stopped) safeToRemove();
      });
      return () => {
        stopped = true;
      };
    }, [present, safeToRemove, toChat]);

    return (
      <div
        ref={combinedRef}
        className="panel-page"
        data-leaving={leaving || !present ? '' : undefined}
        inert={leaving || !present}
      >
        {children}
      </div>
    );
  },
);

/**
 * The welcome fades when Send is pressed and returns only if submission fails. Once the chat
 * opens, presence moves it out of layout and removes it after that same fade finishes.
 */
export function WelcomePresence({
  shown,
  leaving,
  toChat,
  children,
}: {
  shown: boolean;
  /** A new chat's first send is in flight. */
  leaving: boolean;
  /** The welcome gave way to the conversation a new chat opened. */
  toChat: boolean;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false} mode="popLayout" custom={toChat}>
      {shown && (
        <WelcomePage key="welcome" leaving={leaving}>
          {children}
        </WelcomePage>
      )}
    </AnimatePresence>
  );
}
