import type { ReactNode } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';

/*
 * The welcome steps back the moment a new chat's first message lifts out of the composer, and
 * quickly: what replaces it is that message, flying to its turn (`MessageFlight`), so the page has
 * nothing to linger over. Only opacity moves, which the compositor runs while the conversation
 * mounts, and under Reduce Motion it is the cross-fade that stands in for movement.
 */
const LEAVE = { duration: 0.2, ease: [0, 0, 0.2, 1] } as const;
const RETURN = { duration: 0.25, ease: [0, 0, 0.2, 1] } as const;

const WELCOME: Variants = {
  shown: { opacity: 1, transition: RETURN },
  leaving: { opacity: 0, transition: LEAVE },
  // Any other way off the welcome (the history, the apps) changes page at once, as before.
  exit: (toChat: boolean) => ({ opacity: 0, transition: toChat ? LEAVE : { duration: 0 } }),
};

/**
 * The welcome page, and how it gives way to a new chat. It steps back while the first message is
 * on its way (`leaving`) and returns if the send fails. When the chat opens it stays mounted until
 * it has finished leaving, lifted out of the layout (`popLayout`) and under the conversation.
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
        <motion.div
          key="welcome"
          className="panel-page"
          variants={WELCOME}
          custom={toChat}
          initial={false}
          animate={leaving ? 'leaving' : 'shown'}
          exit="exit"
          inert={leaving}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
