import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import { StreamdownMarkdown } from './markdown';

/** One assistant message; the turn's action bar (copy) sits below the whole turn instead. */
export function AssistantBlock({ block }: { block: BlockOf<'assistant'> }) {
  const { t } = useTranslation('tasks');
  return (
    <div className="assistant-block">
      {block.text && <StreamdownMarkdown text={block.text} streaming={block.streaming} />}
      {block.stopReason === 'aborted' && (
        <p className="text-xs text-muted-foreground">{t('conversation.stopped')}</p>
      )}
      {block.error && <p className="text-sm text-destructive">{block.error}</p>}
    </div>
  );
}
