import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@atd/ui/components/skeleton';

/**
 * The live title line shared by the header and history. The text stays in layout while pending,
 * so its typography and available width size both layers identically, including truncation.
 * Settled titles mount still; the readable fallback also keeps a pending task identifiable.
 */
export function ConversationTitle({
  title,
  pending,
  children = title,
}: {
  title: string;
  pending: boolean;
  /** A title with search matches marked; its accessible name remains the complete plain title. */
  children?: ReactNode;
}) {
  const { t } = useTranslation('panel');
  const reduced = useReducedMotion();
  const transition = { duration: reduced ? 0.1 : 0.2, ease: 'easeOut' } as const;
  return (
    <span
      className="relative inline-grid max-w-full min-w-0 align-middle"
      aria-busy={pending || undefined}
    >
      <span className="sr-only">
        {title}
        {pending && ` — ${t('titles.generating')}`}
      </span>
      <motion.span
        aria-hidden
        className="block min-w-0 truncate"
        initial={false}
        animate={{ opacity: pending ? 0 : 1 }}
        transition={transition}
      >
        {children}
      </motion.span>
      <AnimatePresence initial={false} mode="sync">
        {pending && (
          <motion.span
            key="pending"
            aria-hidden
            className="absolute inset-0 block"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            <Skeleton className="size-full rounded-full" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
