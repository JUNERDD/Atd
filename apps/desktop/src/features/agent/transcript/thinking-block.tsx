import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import { ActivityRow } from './activity-row';
import { DetailBox } from './detail-box';
import { formatElapsed } from './elapsed';
import { StreamdownMarkdown } from './markdown';

/**
 * Single-line reasoning row showing `Thought 5s` once settled; live streams the `Thinking`
 * line through the shared shimmer, exactly like a running tool. Reasoning is only ever read
 * on purpose by opening the row.
 */
export function ThinkingBlock({ block }: { block: BlockOf<'thinking'> }) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const elapsed = block.durationMs == null ? null : formatElapsed(block.durationMs);
  const summary = block.redacted
    ? t('thinking.redacted')
    : block.streaming
      ? t('transcript.verb.thinkLive')
      : elapsed == null
        ? t('transcript.verb.thinkDone')
        : t('thinking.doneWithElapsed', { elapsed });
  const icon = <Sparkles className="row-icon" strokeWidth={1.75} />;
  if (block.redacted) {
    // Static row: nothing to expand, but the same Root/Icon/Title frame and trigger geometry
    // so the icon and text edges align with every other row. The icon box carries no chevron.
    return (
      <ActivityRow.Root status="completed" className="thinking-row" aria-label={summary}>
        <div className="activity-row-static">
          <ActivityRow.Icon chevron={false}>{icon}</ActivityRow.Icon>
          <ActivityRow.Title className="thinking-line" title={summary}>
            {summary}
          </ActivityRow.Title>
        </div>
      </ActivityRow.Root>
    );
  }
  return (
    <ActivityRow.Root
      open={open}
      onOpenChange={setOpen}
      status={block.streaming ? 'running' : 'completed'}
      className="flex min-w-0 flex-col"
    >
      <ActivityRow.Trigger
        aria-label={open ? t('thinking.title') : `${t('thinking.title')}: ${summary}`}
      >
        <ActivityRow.Icon>{icon}</ActivityRow.Icon>
        <ActivityRow.Title className="thinking-line" title={summary}>
          {block.streaming ? <Shimmer as="span">{summary}</Shimmer> : summary}
        </ActivityRow.Title>
      </ActivityRow.Trigger>
      <ActivityRow.Content>
        <ActivityRow.Body className="thinking-full">
          <DetailBox variant="plain" copyText={block.text}>
            <StreamdownMarkdown text={block.text} streaming={block.streaming} />
          </DetailBox>
        </ActivityRow.Body>
      </ActivityRow.Content>
    </ActivityRow.Root>
  );
}

export function SystemBlock({ block }: { block: BlockOf<'system'> }) {
  return (
    <p
      className={`system-note text-sm text-muted-foreground${block.level === 'error' ? ' text-destructive' : ''}`}
    >
      {block.text}
    </p>
  );
}
