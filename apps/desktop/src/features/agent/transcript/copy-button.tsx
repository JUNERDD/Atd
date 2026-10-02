import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@atd/ui/lib/utils';
import { IconButton } from '../../../components/icon-button';
import { useCopyFeedback } from './use-copy-feedback';

/**
 * Sole owner of the copy-to-clipboard button used at the top-right of every desc box. Copies
 * `text` verbatim; the brief copied state pins the tooltip as feedback. Always renders inside a
 * `group` box (see `DetailBox`): the button stays hidden until the box is hovered or focused,
 * or a copy just landed.
 */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation('tasks');
  const { copied, pinned, unpin, copy } = useCopyFeedback();

  return (
    <IconButton
      label={copied ? t('transcript.code.copied') : t('transcript.code.copy')}
      tooltipPinned={pinned}
      onPointerLeave={unpin}
      onClick={() => void copy(text)}
      className={cn(
        'absolute top-1 right-1 transition-opacity',
        copied || pinned
          ? 'opacity-100'
          : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
        className,
      )}
    >
      {copied ? <Check /> : <Copy />}
    </IconButton>
  );
}
