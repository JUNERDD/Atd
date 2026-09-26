import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../../components/icon-button';
import { showErrorToast } from '../../../components/toast-store';
import { agentApi } from '../use-agent';

const COPIED_DURATION_MS = 1_000;

/**
 * The action bar that closes a settled turn, below everything the turn shows (tool activity and
 * a stop note included). Copy takes `text`, the turn's final answer; the brief copied state pins
 * the tooltip as feedback.
 */
export function TurnActions({ text }: { text: string }) {
  const { t } = useTranslation('tasks');
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
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
    <div className="message-actions">
      <IconButton
        label={copied ? t('conversation.copied') : t('conversation.copy')}
        aria-label={t('conversation.copyResponseLabel')}
        tooltipPinned={pinned}
        onPointerLeave={() => setPinned(false)}
        onClick={() => void copy()}
      >
        {copied ? <Check /> : <Copy />}
      </IconButton>
    </div>
  );
}
