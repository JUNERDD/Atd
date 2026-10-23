import { forwardRef, useLayoutEffect, type ReactNode } from 'react';
import { AnimatePresence, usePresence, usePresenceData } from 'motion/react';

/** MessageFlight owns both pages' opacity and releases this page when their dissolve ends. */
const WelcomePage = forwardRef<HTMLDivElement, { pending: boolean; children: ReactNode }>(
  function WelcomePage({ pending, children }, ref) {
    const [present, safeToRemove] = usePresence();
    const toChat = usePresenceData() === true;

    useLayoutEffect(() => {
      // Keep the actual page, including its layout and scroll position, until the arriving page
      // has participated in the shared dissolve. Other navigation still replaces it immediately.
      if (!present && !toChat) safeToRemove();
    }, [present, safeToRemove, toChat]);

    return (
      <div ref={ref} className="panel-page" inert={pending || !present}>
        {children}
      </div>
    );
  },
);

/**
 * Keep the welcome visible while submission is pending. Once the chat opens, presence moves it
 * out of layout so both pages overlap. MessageFlight removes it after their shared dissolve.
 */
export function WelcomePresence({
  shown,
  pending,
  toChat,
  children,
}: {
  shown: boolean;
  /** A new chat's first send is in flight. */
  pending: boolean;
  /** The welcome gave way to the conversation a new chat opened. */
  toChat: boolean;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false} mode="popLayout" custom={toChat}>
      {shown && (
        <WelcomePage key="welcome" pending={pending}>
          {children}
        </WelcomePage>
      )}
    </AnimatePresence>
  );
}
