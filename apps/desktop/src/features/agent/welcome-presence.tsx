import { forwardRef, useEffect, type ReactNode } from 'react';
import { AnimatePresence, usePresence, usePresenceData } from 'motion/react';

/** MessageFlight owns both pages' opacity and releases this page when their dissolve ends. */
const WelcomePage = forwardRef<HTMLDivElement, { pending: boolean; children: ReactNode }>(
  function WelcomePage({ pending, children }, ref) {
    const [present, safeToRemove] = usePresence();
    const toChat = usePresenceData() === true;

    useEffect(() => {
      // AnimatePresence registers exiting keys in its parent layout effect. Release after that
      // registration; a child layout effect can report completion too early and strand the page.
      if (!present && !toChat) safeToRemove();
    }, [present, safeToRemove, toChat]);

    return (
      <div
        ref={ref}
        className="panel-page"
        hidden={!present && !toChat}
        inert={pending || !present}
      >
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
