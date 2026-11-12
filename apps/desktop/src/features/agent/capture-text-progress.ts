import {
  landsOnScreenshot,
  parseCaptureAnswer,
  type CaptureParagraph,
  type CommandOutputAction,
} from '@atd/agent-contracts';
import type { RunStatus } from '../../client/agent/task-schema';
import type { CaptureTextProgress } from '../../client/capture-bridge';
import { MAX_CAPTURE_TEXT_PARAGRAPHS } from '../../native-bridge/capture-text-calls';
import { MAX_CAPTURE_LENGTH, MAX_NATIVE_TEXT_LENGTH } from '../../native-bridge/primitives';
import type { ReviewCard } from './review-card';

/** What a run on screenshot text reports of itself in each update. */
export interface ProgressSource {
  /** The shell's id for the run. */
  id: string;
  /** Where its answer goes, the same in every update. */
  output: CommandOutputAction;
  /** Its answer waits for the person to apply it before it lands, the same in every update. */
  awaitsApply: boolean;
  /** What it reads, which its answer's blocks refer to. */
  paragraphs: readonly CaptureParagraph[];
}

/** The card's last state for a run that ended with `status`. */
export function finalState(status: RunStatus): 'done' | 'stopped' | 'failed' {
  if (status === 'completed') return 'done';
  return status === 'stopped' || status === 'cancelled' ? 'stopped' : 'failed';
}

/**
 * Whether `answer` gives the card something to show for `source`: for an output that lands on the
 * screenshot, at least one piece (`parseCaptureAnswer`, read as final); for any other, some text.
 */
export function usableAnswer(source: ProgressSource, answer: string): boolean {
  const { output, paragraphs } = source;
  if (!landsOnScreenshot(output)) return answer.trim() !== '';
  return parseCaptureAnswer(answer, { action: output, paragraphs, final: true }).items.length > 0;
}

/**
 * The parsed answer of an output that lands on the screenshot, cut to what the result card takes:
 * the lead and each piece's text within the capture limit (a phrase is part of a paragraph, so it
 * already is), and no more pieces than paragraphs a run reads.
 */
function resultOf(
  source: ProgressSource,
  text: string,
  final: boolean,
): CaptureTextProgress['result'] {
  const { output, paragraphs } = source;
  if (!landsOnScreenshot(output)) return undefined;
  const { lead, items } = parseCaptureAnswer(text, { action: output, paragraphs, final });
  return {
    lead: lead.slice(0, MAX_CAPTURE_LENGTH),
    items: items
      .slice(0, MAX_CAPTURE_TEXT_PARAGRAPHS)
      .map((item) => ({ ...item, text: item.text.slice(0, MAX_CAPTURE_LENGTH) })),
  };
}

/**
 * The update that shows `source` in `state` with the answer `text` so far: the text itself, cut
 * to what the bridge takes, and for an output that lands on the screenshot also its pieces
 * (`parseCaptureAnswer`: a block still being written counts only once `final`); `review`, the
 * card's state of the run's versions, once it has them or while the first version of an answer
 * that awaits applying is made. Without versions a `failed` update's text says why, so it has no
 * pieces; with them `text` is the version shown, which a failed attempt keeps.
 */
export function captureProgress(
  source: ProgressSource,
  state: CaptureTextProgress['state'],
  text: string,
  final: boolean,
  review?: ReviewCard,
): CaptureTextProgress {
  const result = state === 'failed' && !review ? undefined : resultOf(source, text, final);
  return {
    runId: source.id,
    state,
    output: source.output,
    text: text.slice(0, MAX_NATIVE_TEXT_LENGTH),
    ...(result ? { result } : {}),
    awaitsApply: source.awaitsApply,
    ...(review ? { review } : {}),
  };
}

/**
 * The version being made of a run that has versions, read as `source` (what its run read), with
 * its answer `text` so far (`captureText.progress`'s `draft`): the text cut to what the bridge
 * takes and, for an output that lands on the screenshot, its pieces completed so far.
 */
export function captureDraft(
  source: ProgressSource,
  text: string,
): NonNullable<CaptureTextProgress['draft']> {
  const result = resultOf(source, text, false);
  return { text: text.slice(0, MAX_NATIVE_TEXT_LENGTH), ...(result ? { result } : {}) };
}
