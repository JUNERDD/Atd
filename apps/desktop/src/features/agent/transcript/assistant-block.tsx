import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import { IconButton } from '../../../components/icon-button';
import { agentApi } from '../use-agent';
import { showErrorToast } from '../../../components/toast-store';
import { StreamdownMarkdown } from './markdown';

const COPIED_DURATION_MS = 1_000;

export function AssistantBlock({
  block,
  showCopy,
}: {
  block: BlockOf<'assistant'>;
  showCopy?: boolean;
}) {
  const { t } = useTranslation('tasks');
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await agentApi().copy(block.text);
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
    <div className="assistant-block">
      {block.text && <StreamdownMarkdown text={block.text} streaming={block.streaming} />}
      {block.stopReason === 'aborted' && (
        <p className="text-xs text-muted-foreground">{t('conversation.stopped')}</p>
      )}
      {block.error && <p className="text-sm text-destructive">{block.error}</p>}
      {showCopy && block.text && (
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
      )}
    </div>
  );
}
