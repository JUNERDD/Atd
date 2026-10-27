import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@atd/ui/components/skeleton';

/**
 * The live title line shared by the header and history. Both layers occupy one line, so a
 * pending summary dissolves into its title without an empty frame or shifting its baseline.
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
      className="inline-grid h-5 max-w-full min-w-0 items-center align-middle"
      aria-busy={pending || undefined}
    >
      <span className="sr-only">
        {title}
        {pending && ` — ${t('titles.generating')}`}
      </span>
      <AnimatePresence initial={false} mode="sync">
        {pending ? (
          <motion.span
            key="pending"
            aria-hidden
            className="col-start-1 row-start-1 block w-28 max-w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            <Skeleton className="h-3 w-full rounded-full" />
          </motion.span>
        ) : (
          <motion.span
            key="title"
            aria-hidden
            className="col-start-1 row-start-1 block min-w-0 truncate"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            {children}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
