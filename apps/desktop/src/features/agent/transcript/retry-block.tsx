import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { ActivityRow } from './activity-row';
import { StaticRow } from './compaction-block';

/**
 * A failed model request the service is retrying. It shimmers "Request failed · Retrying (n/m)…"
 * beside a spinner, with the provider's error below, until the retry gets a response or the
 * retries end; the run's outcome then shows as usual.
 */
export function RetryBlock({ block }: { block: BlockOf<'retry'> }) {
  const { t } = useTranslation('tasks');
  const label = t('retry.running', { attempt: block.attempt, max: block.maxAttempts });
  return (
    <ActivityRow.Root status="running" className="retry-row" aria-label={label}>
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
      {block.error && <p className="retry-error">{block.error}</p>}
    </ActivityRow.Root>
  );
}
