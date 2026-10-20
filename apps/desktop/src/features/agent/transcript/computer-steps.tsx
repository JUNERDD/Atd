import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  FileIcon,
  ImageIcon,
  Link,
  TextCursorInput,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ActionResult, ComputerDetails } from '@atd/agent-contracts';
import { ImageLightbox } from '../image-lightbox';

type StepState = 'done' | 'stopped' | 'notReached';
type EvidenceKind = ActionResult['evidence'][number]['kind'];

/** Where one step of an action stands in its result: finished, where it stopped, or not reached. */
function stepState(result: ActionResult | undefined, index: number): StepState | null {
  if (!result) return null;
  if (index < result.completedSteps) return 'done';
  if (index === result.stoppedAt) return 'stopped';
  return 'notReached';
}

/** A step's node on the rail, in the Todos list's glyph style; a step without a result is a dot. */
const STEP_ICONS: Record<StepState | 'planned', LucideIcon> = {
  done: CircleCheck,
  stopped: CircleAlert,
  notReached: CircleDashed,
  planned: Circle,
};

/**
 * An action's steps on a vertical rail: each step's node says how far the action got, its
 * summary (never the text a step typed) reads in the foreground, and its effect and state follow
 * in secondary text. The state is spelled out beside every node, so neither the glyph nor the
 * warning tone of the step where it stopped carries the meaning alone.
 */
export function ComputerSteps({
  steps,
  result,
}: {
  steps: ComputerDetails['steps'];
  result: ActionResult | undefined;
}) {
  const { t } = useTranslation('tasks');
  return (
    <ol className="computer-steps">
      {steps.map((step, index) => {
        const state = stepState(result, index);
        const Icon = STEP_ICONS[state ?? 'planned'];
        return (
          <li key={index} className="computer-step" data-state={state ?? 'planned'}>
            <span className="computer-step-node" aria-hidden="true">
              <Icon strokeWidth={1.75} />
            </span>
            <span className="computer-step-summary">{step.summary}</span>
            <span className="computer-step-meta">
              {t(`computer.effect.${step.effect}`)}
              {state && ` · ${t(`computer.stepState.${state}`)}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Each kind of evidence has its own glyph beside the kind's name. */
const EVIDENCE_ICONS: Record<EvidenceKind, LucideIcon> = {
  value: TextCursorInput,
  text: Type,
  url: Link,
  file: FileIcon,
  screenshot: ImageIcon,
};

/**
 * What the host gathered to back the outcome: one row per item, its kind as a glyph and a name,
 * then the summary; a picture follows its row as a thumbnail that opens the whole picture.
 */
export function ComputerEvidence({ evidence }: { evidence: ActionResult['evidence'] }) {
  const { t } = useTranslation('tasks');
  return (
    <ul className="computer-evidence">
      {evidence.map((item, index) => {
        const Icon = EVIDENCE_ICONS[item.kind];
        return (
          <li key={index} className="computer-evidence-item">
            <span className="computer-evidence-kind">
              <Icon strokeWidth={1.75} aria-hidden="true" />
              {t(`computer.evidenceKind.${item.kind}`)}
            </span>
            <span className="computer-evidence-summary">{item.summary}</span>
            {item.resourceId && item.kind === 'screenshot' && (
              <span className="computer-evidence-picture">
                <ImageLightbox
                  file={{ id: item.resourceId, name: item.summary, size: 0, type: 'image/png' }}
                  variant="wide"
                />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
