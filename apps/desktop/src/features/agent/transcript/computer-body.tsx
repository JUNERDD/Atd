import { EyeOff, MousePointerClick } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ComputerDetails } from '@atd/agent-contracts';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { ImageLightbox } from '../image-lightbox';
import { computerOutcome, computerVisualOff } from './computer-call';
import { ComputerFollowUp } from './computer-follow-up';
import { ComputerDisturbances, ComputerErrorLine, ComputerSummary } from './computer-outcome';
import { ComputerEvidence, ComputerSteps } from './computer-steps';
import { ToolCard } from './tool-card';
import './computer-row.css';
import './tool-list.css';

/**
 * The latest view Atd saved of the target: a thumbnail that opens the whole picture in the
 * lightbox, beside when the call recorded it, so it never reads as a live picture.
 */
function LatestView({ resourceId, recordedAt }: { resourceId: string; recordedAt: number }) {
  const { t, i18n } = useTranslation('tasks');
  const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'medium' }).format(recordedAt);
  return (
    <section className="computer-section">
      <h4 className="generic-section-label">{t('computer.latestView')}</h4>
      <div className="computer-view">
        <ImageLightbox
          file={{ id: resourceId, name: t('computer.latestView'), size: 0, type: 'image/png' }}
          variant="wide"
        />
        <p className="computer-view-caption">{t('computer.viewCaption', { time })}</p>
      </div>
    </section>
  );
}

/**
 * The detail of a settled `computer` call. It shows only what the call recorded, in reading
 * order — what took effect and why it stopped (or, for any other operation, why the host refused
 * it), what changed for the person while it ran that they did not do themselves, the steps on a
 * rail with how far the action got (never the text a step typed), the evidence the host gathered,
 * the latest saved view of the target, and a note when an observation found visual steps off —
 * so a call that recorded little reads as a short card, never one with empty bands. What the person can do about the outcome follows in the footer. The
 * header is the card's only title, as on every tool card: the target on the left, the outcome and
 * how many steps took effect on the right, and the copy action for what the agent read; the
 * sections under it carry only their small labels. Calls that recorded none of these never reach
 * this card (`computerHasDetail`).
 */
export function ComputerBody({ block, data }: { block: BlockOf<'tool'>; data: ComputerDetails }) {
  const { t } = useTranslation('tasks');
  const { result, steps } = data;
  const outcome = result ? computerOutcome(result) : null;
  const latestView = data.resourceIds.at(-1);
  const visualOff = computerVisualOff(data);
  const evidence = result?.evidence ?? [];
  // The person knows what they did themselves; the rest is what Atd may have caused.
  const disturbances = (result?.disturbances ?? []).filter(
    ({ attribution }) => attribution !== 'person',
  );
  // The header is the card's one title: the target on the left, and on the right how the action
  // turned out and how many of its steps took effect, like every tool card's facts.
  const facts = [
    outcome && t(`computer.outcome.${outcome}`),
    result &&
      steps.length > 0 &&
      t('computer.progress', { completed: result.completedSteps, count: steps.length }),
  ].filter(Boolean);
  return (
    <ToolCard.Root>
      <ToolCard.Header
        icon={<MousePointerClick />}
        label={data.target ?? t('computer.unnamedTarget')}
        meta={facts.length > 0 ? facts.join(' · ') : undefined}
        copyText={block.output}
      />
      <ToolCard.Body size="lg" className="computer-sections">
        {result && outcome && (
          <ComputerSummary outcome={outcome} result={result} total={steps.length} />
        )}
        {!result && data.error && <ComputerErrorLine error={data.error} />}
        {disturbances.length > 0 && (
          <section className="computer-section">
            <h4 className="generic-section-label">{t('computer.disturbance.title')}</h4>
            <ComputerDisturbances disturbances={disturbances} />
          </section>
        )}
        {steps.length > 0 && (
          <section className="computer-section">
            <h4 className="generic-section-label">{t('computer.steps')}</h4>
            <ComputerSteps steps={steps} result={result} />
          </section>
        )}
        {evidence.length > 0 && (
          <section className="computer-section">
            <h4 className="generic-section-label">{t('computer.evidence')}</h4>
            <ComputerEvidence evidence={evidence} />
          </section>
        )}
        {latestView && <LatestView resourceId={latestView} recordedAt={block.endedAt} />}
        {visualOff && (
          <p className="computer-visual-note">
            <EyeOff strokeWidth={1.75} aria-hidden="true" />
            {t(`computer.visual.${visualOff}`)}
          </p>
        )}
      </ToolCard.Body>
      <ComputerFollowUp block={block} data={data} />
    </ToolCard.Root>
  );
}
