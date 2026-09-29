import { useState, type ReactNode } from 'react';
import { FoldVertical, LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import { Button } from '@ai/ui/components/button';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { formatTokenCount } from '../../providers/context-window';
import { ActivityRow } from './activity-row';
import { useCompactionRetry } from './compaction-context';
import { DetailBox } from './detail-box';
import { LazyMarkdown } from './lazy-markdown';

/** A one-line row without a body, on the same frame and icon geometry as expandable rows. */
function StaticRow({
  status,
  label,
  icon,
  children,
}: {
  status: string;
  label: string;
  icon: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="activity-row-static">
      <ActivityRow.Icon chevron={false}>{icon}</ActivityRow.Icon>
      <ActivityRow.Title className="thinking-line" title={label}>
        {status === 'running' ? <Shimmer as="span">{label}</Shimmer> : label}
      </ActivityRow.Title>
      {children}
    </div>
  );
}

/**
 * One context compaction in the conversation. Running, it shimmers "Compacting context…" beside
 * a spinner. Completed, it reads "Context compacted · ~X → Y tokens" (without numbers the service
 * did not know) and opens to the Markdown summary the model continues from. Failed, it names the
 * reason and, while it is the latest compaction, offers Retry where the task can be compacted (the
 * task transcript, not a subagent's).
 */
export function CompactionBlock({ block }: { block: BlockOf<'compaction'> }) {
  const { t } = useTranslation('tasks');
  const retry = useCompactionRetry();
  const [open, setOpen] = useState(false);
  if (block.status === 'running') {
    const label = t('compaction.running');
    return (
      <ActivityRow.Root status="running" className="compaction-row" aria-label={label}>
        <StaticRow
          status="running"
          label={label}
          icon={
            <LoaderCircle
              className="row-icon animate-spin motion-reduce:animate-none"
              strokeWidth={1.75}
            />
          }
        />
      </ActivityRow.Root>
    );
  }
  if (block.status === 'failed') {
    const label = t('compaction.failed');
    return (
      <ActivityRow.Root status="failed" className="compaction-row">
        <StaticRow
          status="failed"
          label={label}
          icon={<TriangleAlert className="row-icon" strokeWidth={1.75} />}
        >
          {retry?.latestCompaction === block.id && (
            <Button variant="outline" size="xs" disabled={retry.disabled} onClick={retry.retry}>
              <RotateCcw />
              {t('compaction.retry')}
            </Button>
          )}
        </StaticRow>
        {block.error && <p className="compaction-error">{block.error}</p>}
      </ActivityRow.Root>
    );
  }
  const label =
    block.tokensBefore !== null && block.tokensAfter !== null
      ? t('compaction.doneWithTokens', {
          before: formatTokenCount(block.tokensBefore),
          after: formatTokenCount(block.tokensAfter),
        })
      : t('compaction.done');
  const icon = <FoldVertical className="row-icon" strokeWidth={1.75} />;
  if (!block.summary.trim())
    return (
      <ActivityRow.Root status="completed" className="compaction-row" aria-label={label}>
        <StaticRow status="completed" label={label} icon={icon} />
      </ActivityRow.Root>
    );
  return (
    <ActivityRow.Root
      open={open}
      onOpenChange={setOpen}
      status="completed"
      className="compaction-row"
    >
      <ActivityRow.Trigger aria-label={open ? t('compaction.summaryLabel') : label}>
        <ActivityRow.Icon>{icon}</ActivityRow.Icon>
        <ActivityRow.Title className="thinking-line" title={label}>
          {label}
        </ActivityRow.Title>
      </ActivityRow.Trigger>
      <ActivityRow.Content>
        <ActivityRow.Body className="thinking-full">
          <DetailBox variant="plain" copyText={block.summary}>
            <LazyMarkdown text={block.summary} streaming={false} />
          </DetailBox>
        </ActivityRow.Body>
      </ActivityRow.Content>
    </ActivityRow.Root>
  );
}
