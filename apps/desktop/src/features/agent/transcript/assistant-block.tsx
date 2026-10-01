import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { LazyMarkdown } from './lazy-markdown';

/** One assistant message; the turn's action bar (copy) sits below the whole turn instead. */
export function AssistantBlock({ block }: { block: BlockOf<'assistant'> }) {
  const { t } = useTranslation('tasks');
  return (
    // A streaming message replaces its nodes as it grows; the selection toolbar skips it. The block
    // id lets a quote chip find its passage again (selection-toolbar/quote-source.ts).
    <div
      className="assistant-block"
      data-block-id={block.id}
      data-streaming={block.streaming || undefined}
    >
      {block.text && <LazyMarkdown text={block.text} streaming={block.streaming} />}
      {block.stopReason === 'aborted' && (
        <p className="text-xs text-muted-foreground">{t('conversation.stopped')}</p>
      )}
      {block.error && <p className="text-sm text-destructive">{block.error}</p>}
    </div>
  );
}
