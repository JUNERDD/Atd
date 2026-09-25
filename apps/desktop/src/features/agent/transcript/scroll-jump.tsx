import { useTranslation } from 'react-i18next';
import { ArrowDown } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { IconButton } from '../../../components/icon-button';

/** The floating scroll-to-bottom action a transcript shows once the reader leaves the bottom. */
export function ScrollJump({ show, onJump }: { show: boolean; onJump: () => void }) {
  const { t } = useTranslation('tasks');
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {show && (
          <motion.div
            className="scroll-to-bottom"
            initial={{ opacity: 0, x: '-50%', y: 16, scale: 0.95 }}
            animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
            exit={{ opacity: 0, x: '-50%', y: 16, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            whileTap={{ scale: 0.85 }}
          >
            <IconButton label={t('conversation.scrollToBottom')} tooltip={false} onClick={onJump}>
              <ArrowDown />
            </IconButton>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
