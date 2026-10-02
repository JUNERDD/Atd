import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@atd/ui/components/ai-elements/shimmer';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { ActivityRow } from './activity-row';
import { DetailBox } from './detail-box';
import { formatElapsed } from './elapsed';
import { LazyMarkdown } from './lazy-markdown';
import { latestHeading, thinkingExcerpt } from './thinking-excerpt';
import { useFollowStream } from './thinking-follow';

/**
 * Single-line reasoning row. Settled, it reads `Thought 5s` followed by a muted one-line excerpt
 * (the first section heading or sentence), so consecutive thoughts tell apart at a glance; live,
 * it streams `Thinking` through the shared shimmer, joined by the newest section heading when
 * the model writes headings, exactly like a running tool's `${title} ${meta}`. The tooltip and
 * accessible name stay the summary. Opening the row shows the full trace on the shared detail
 * surface, following the newest text while it streams.
 */
export function ThinkingBlock({ block }: { block: BlockOf<'thinking'> }) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const followRef = useFollowStream(block.streaming);
  const elapsed = block.durationMs == null ? null : formatElapsed(block.durationMs);
  const summary = block.redacted
    ? t('thinking.redacted')
    : block.streaming
      ? t('transcript.verb.thinkLive')
      : elapsed == null
        ? t('transcript.verb.thinkDone')
        : t('thinking.doneWithElapsed', { elapsed });
  // Model text, parsed once per change; the redacted placeholder has nothing to digest.
  const meta = useMemo(
    () =>
      block.redacted
        ? null
        : block.streaming
          ? latestHeading(block.text)
          : thinkingExcerpt(block.text),
    [block.redacted, block.streaming, block.text],
  );
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
  const heading = block.streaming ? (
    <ActivityRow.Title className="thinking-line" title={summary}>
      <Shimmer as="span">{meta ? `${summary} ${meta}` : summary}</Shimmer>
    </ActivityRow.Title>
  ) : meta ? (
    <>
      {/* The summary hugs its text; the excerpt fills the rest of the row and truncates first. */}
      <ActivityRow.Title className="flex-initial" title={summary}>
        {summary}
      </ActivityRow.Title>
      <ActivityRow.Meta className="activity-meta">{meta}</ActivityRow.Meta>
    </>
  ) : (
    <ActivityRow.Title className="thinking-line" title={summary}>
      {summary}
    </ActivityRow.Title>
  );
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
        {heading}
      </ActivityRow.Trigger>
      <ActivityRow.Content>
        <ActivityRow.Body className="thinking-full">
          <DetailBox variant="plain" copyText={block.text}>
            {/* Reasoning streams long and fast into the detail box: no per-character reveal. */}
            <div ref={followRef}>
              <LazyMarkdown text={block.text} streaming={block.streaming} animated={false} />
            </div>
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
