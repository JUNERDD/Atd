import {
  CAPTURE_ANSWER_TOOL,
  extractCaptureProgress,
  landsOnScreenshot,
  mergeCaptureAnswers,
  serializeCaptureAnswer,
  type CaptureAnswer,
  type CaptureParagraph,
  type CommandOutputAction,
} from '@atd/agent-contracts';
import type { Block } from '../../client/agent/transcript-schema';
import { lastAnswerText } from './transcript/final-answer';

export interface CaptureAnswerSource {
  output: CommandOutputAction;
  paragraphs: readonly CaptureParagraph[];
}

/**
 * Reads one screenshot-text run's answer from transcript `blocks`: non-landing outputs use the
 * assistant text (`lastAnswerText`), while landing outputs merge all non-failed/non-declined
 * `mark_screenshot` tool blocks after the last `user` or `retry` block for `runId` via
 * `extractCaptureProgress` + `mergeCaptureAnswers`, falling back to `assistantLead` under
 * `annotate` for 0-tool Q&A.
 */
export function captureRunAnswer(
  blocks: readonly Block[],
  runId: string,
  source: CaptureAnswerSource,
): string {
  const assistantLead = lastAnswerText(blocks, runId);
  if (!landsOnScreenshot(source.output)) return assistantLead;
  let start = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (b?.runId === runId && (b.kind === 'user' || b.kind === 'retry')) start = i + 1;
  }
  const parts: CaptureAnswer[] = [];
  for (let i = start; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (
      block?.runId !== runId ||
      block.kind !== 'tool' ||
      block.name !== CAPTURE_ANSWER_TOOL ||
      block.status === 'failed' ||
      block.status === 'declined'
    )
      continue;
    // When `streaming` is explicitly `false`, the tool call's JSON has closed even while
    // `status` is `'running'` (awaiting later parallel calls or toolResult persistence).
    const settled = block.status !== 'running' || block.streaming === false;
    parts.push(
      extractCaptureProgress(block.args, {
        action: source.output,
        paragraphs: source.paragraphs,
        settled,
        assistantLead,
      }),
    );
  }
  if (!parts.length) return source.output === 'annotate' ? assistantLead : '';
  return serializeCaptureAnswer(
    mergeCaptureAnswers(parts, {
      action: source.output,
      paragraphs: source.paragraphs,
      assistantLead,
    }),
  );
}
