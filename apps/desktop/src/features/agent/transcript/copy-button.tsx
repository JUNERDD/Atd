import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@ai/ui/lib/utils';
import { agentApi } from '../use-agent';
import { showErrorToast } from '../../../components/toast-store';
import { IconButton } from '../../../components/icon-button';

const COPIED_DURATION_MS = 1_000;

/**
 * Sole owner of the copy-to-clipboard button used at the top-right of every desc box. Copies
 * `text` verbatim; the brief copied state pins the tooltip as feedback. Always renders inside a
 * `group` box (see `DetailBox`): the button stays hidden until the box is hovered or focused,
 * or a copy just landed.
 */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation('tasks');
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copyAll() {
    try {
      await agentApi().copy(text);
      setCopied(true);
      setPinned(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
        setPinned(false);
      }, COPIED_DURATION_MS);
    } catch (error) {
      showErrorToast(error);
      setCopied(false);
      setPinned(false);
    }
  }

  return (
    <IconButton
      label={copied ? t('transcript.code.copied') : t('transcript.code.copy')}
      tooltipPinned={pinned}
      onPointerLeave={() => setPinned(false)}
      onClick={() => void copyAll()}
      className={cn(
        'absolute top-1 right-1 transition-opacity',
        copied || pinned
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        className,
      )}
    >
      {copied ? <Check /> : <Copy />}
    </IconButton>
  );
}
