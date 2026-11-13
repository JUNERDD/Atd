import {
  CAPTURE_ANSWER_TOOL,
  MarkScreenshotParamsSchema,
  parseCaptureSelection,
  serializeCaptureAnswer,
  validateCaptureToolCall,
  type CaptureAnswerAction,
  type CaptureParagraph,
} from '@atd/agent-contracts';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { Ledger } from '../ledger.js';

export interface CaptureRunContext {
  action: CaptureAnswerAction;
  paragraphs: CaptureParagraph[];
}

/**
 * Resolves the screenshot output mode and recognized OCR paragraphs for `runId` by scanning
 * backward through the task's runs until the most recent selection or 0-paragraph boundary.
 */
export function resolveCaptureRunContext(
  ledger: Ledger,
  taskId: string,
  runId: string,
): CaptureRunContext | null {
  const task = ledger.task(taskId);
  const runIndex = task.runs.findIndex((item) => item.id === runId);
  if (runIndex < 0) return null;
  const action = task.runs[runIndex]?.snapshot.captureOutput;
  if (!action) return null;
  for (let i = runIndex; i >= 0; i -= 1) {
    const candidate = task.runs[i];
    if (!candidate) continue;
    if (candidate.snapshot.instructions.includes('no text paragraphs were recognized'))
      return { action, paragraphs: [] };
    const fromSelection = parseCaptureSelection(candidate.snapshot.input.selection);
    if (fromSelection.length > 0) return { action, paragraphs: fromSelection };
    const fromInstructions = parseCaptureSelection(candidate.snapshot.instructions);
    if (fromInstructions.length > 0) return { action, paragraphs: fromInstructions };
  }
  return { action, paragraphs: [] };
}

/**
 * Registers the `mark_screenshot` tool for runs whose answer lands on an open screenshot.
 * Valid calls return `terminate: true` for single-turn completion; invalid calls return
 * `isError: true` without `terminate` so the model can self-correct on the next turn.
 */
export function captureAnswerExtension(
  resolveRun: () => { ledger: Ledger; taskId: string; runId: string },
): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: CAPTURE_ANSWER_TOOL,
      label: 'Mark screenshot',
      description:
        'Record structured replacements, numbered steps, highlights, mosaics, or visual shapes on the open screenshot. Call once or in parallel ordered batches in the same turn; for pure Q&A under annotate, do not call this tool and reply in plain text.',
      parameters: MarkScreenshotParamsSchema,
      executionMode: 'parallel',
      exposure: 'model-only',
      async execute(_toolCallId, params, signal) {
        signal?.throwIfAborted();
        const { ledger, taskId, runId } = resolveRun();
        const context = resolveCaptureRunContext(ledger, taskId, runId);
        if (!context) {
          return {
            content: [{ type: 'text', text: 'Screenshot markup is not enabled for this run.' }],
            details: {},
            isError: true,
          };
        }
        const validated = validateCaptureToolCall(params, context);
        if (!validated.ok) {
          return {
            content: [
              {
                type: 'text',
                text: `${validated.error} Fix and re-issue only this failed mark_screenshot call; do not repeat parallel calls that already succeeded.`,
              },
            ],
            details: {},
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: serializeCaptureAnswer(validated.value) }],
          details: {},
          terminate: true,
        };
      },
    });
  };
}
