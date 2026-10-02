import { useTranslation } from 'react-i18next';
import { ArrowDown } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, type Transition } from 'motion/react';
import { IconButton } from '../../../components/icon-button';

/**
 * Enter eases out like the progress pill above the composer. Exit is quicker and eases in, so the
 * action is gone while the transcript's smooth scroll is still gliding rather than competing with
 * it; it sinks toward the bottom the transcript is heading to.
 */
const ENTER: Transition = { duration: 0.2, ease: [0.22, 1, 0.36, 1] };
const EXIT: Transition = { duration: 0.15, ease: [0.4, 0, 1, 1] };
const PRESS: Transition = { duration: 0.1, ease: 'easeOut' };

/** The floating scroll-to-bottom action a transcript shows once the reader leaves the bottom. */
export function ScrollJump({ show, onJump }: { show: boolean; onJump: () => void }) {
  const { t } = useTranslation('tasks');
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {show && (
          <motion.div
            className="scroll-to-bottom"
            // The exit keeps the pressed scale, so a clicked action never grows back while leaving.
            initial={{ opacity: 0, x: '-50%', y: 8, scale: 0.92 }}
            animate={{ opacity: 1, x: '-50%', y: 0, scale: 1, transition: ENTER }}
            exit={{ opacity: 0, x: '-50%', y: 8, scale: 0.92, transition: EXIT }}
            whileTap={{ scale: 0.92, transition: PRESS }}
          >
            <IconButton
              label={t('conversation.scrollToBottom')}
              tooltip={false}
              variant="glass"
              onClick={onJump}
            >
              <ArrowDown />
            </IconButton>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
