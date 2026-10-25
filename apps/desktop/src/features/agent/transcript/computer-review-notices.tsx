import { useTranslation } from 'react-i18next';
import type { TaskRun } from '../../../client/agent/task-schema';
import { useComputerActionReview } from '../../computer/use-computer';
import type { ViewBlock } from './adapter';
import { ComputerBody } from './computer-body';
import { computerReviewCalls, unresolvedComputerCalls } from './computer-review';
import { useTaskTurns } from './turn-context';

/** Current unresolved facts remain visible after the answer, outside the folded activity. */
export function ComputerReviewNotices({
  steps,
  runs,
}: {
  steps: readonly ViewBlock[];
  runs: readonly TaskRun[];
}) {
  const { t } = useTranslation('tasks');
  const turns = useTaskTurns();
  const candidates = computerReviewCalls(steps, runs);
  const review = useComputerActionReview(
    turns?.taskId ?? '',
    candidates.flatMap((call) => call.actionIds),
    runs.map(({ id, status }) => `${id}:${status}`).join(','),
    Boolean(turns) && candidates.length > 0,
  );
  if (review.state === 'inactive') return null;
  const calls = unresolvedComputerCalls(candidates, review.actionIds);
  if (review.state === 'ready' && calls.length === 0) return null;
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={t('computer.review.title')}>
      <h3 className="generic-section-label">{t('computer.review.title')}</h3>
      {review.state === 'ready' ? (
        calls.map(({ block, data }) => <ComputerBody key={block.id} block={block} data={data} />)
      ) : (
        <output className="m-0 block text-xs text-muted-foreground">
          {t(`computer.review.${review.state}`)}
        </output>
      )}
    </section>
  );
}
