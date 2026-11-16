import {
  CAPTURE_ANSWER_TOOL,
  MarkScreenshotParamsSchema,
  parseCaptureSelection,
  serializeCaptureAnswer,
  validateCaptureToolCall,
  type CaptureAnswerAction,
  type CaptureParagraph,
  type MarkScreenshotParams,
} from '@atd/agent-contracts';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { Ledger } from '../ledger.js';

export interface CaptureRunContext {
  action: CaptureAnswerAction;
  paragraphs: CaptureParagraph[];
  requiresAllParagraphs: boolean;
}

interface RunCoverageState {
  covered: Set<string>;
  stalls: number;
  nudgedOnSettle: boolean;
}

/**
 * Resolves the screenshot output mode, recognized OCR paragraphs, and whether full paragraph
 * coverage is required for `runId` by scanning backward through the task's runs until the most
 * recent selection or 0-paragraph boundary.
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
  const runInstructions = task.runs[runIndex]?.snapshot.instructions ?? '';
  let paragraphs: CaptureParagraph[] = [];
  let fallbackInstructions = '';
  for (let i = runIndex; i >= 0; i -= 1) {
    const candidate = task.runs[i];
    if (!candidate) continue;
    if (candidate.snapshot.instructions.includes('no text paragraphs were recognized'))
      return { action, paragraphs: [], requiresAllParagraphs: false };
    const fromSelection = parseCaptureSelection(candidate.snapshot.input.selection);
    if (fromSelection.length > 0) {
      paragraphs = fromSelection;
      fallbackInstructions = candidate.snapshot.instructions;
      break;
    }
    const fromInstructions = parseCaptureSelection(candidate.snapshot.instructions);
    if (fromInstructions.length > 0) {
      paragraphs = fromInstructions;
      fallbackInstructions = candidate.snapshot.instructions;
      break;
    }
  }
  const pickedScope = (runInstructions || fallbackInstructions).includes(
    'The user picked these paragraphs',
  );
  const requiresAllParagraphs =
    paragraphs.length > 0 &&
    (action === 'replaceSelection' || (action === 'insertAfterSelection' && pickedScope));
  return { action, paragraphs, requiresAllParagraphs };
}

function summarizeIds(ids: readonly string[]): string {
  if (ids.length <= 20) return ids.join(', ');
  return `${ids.slice(0, 15).join(', ')}, ... (${ids.length} total, through ${ids.at(-1)})`;
}

function formatValidationError(
  error: string,
  context: CaptureRunContext,
  priorCovered: ReadonlySet<string>,
  turnCallCount: number,
): string {
  const uncovered = context.paragraphs.map((p) => p.id).filter((id) => !priorCovered.has(id));
  const idHint =
    uncovered.length > 0 && /paragraph id/i.test(error)
      ? ` Valid paragraph ids (pass bare id like "${uncovered[0]}", without brackets or @ bounds): ${summarizeIds(uncovered)}.`
      : '';
  const parallelOrPartial = turnCallCount > 1 || priorCovered.size > 0;
  const retryHint = parallelOrPartial
    ? ' Fix and re-issue only this failed mark_screenshot call; do not repeat parallel calls that already succeeded.'
    : ' Fix the arguments and re-issue mark_screenshot.';
  return `${error}${idHint}${retryHint}`;
}

function collectTurnUnion(
  turnCalls: ReadonlyMap<string, unknown>,
  context: CaptureRunContext,
  priorCovered: ReadonlySet<string>,
): Set<string> {
  const union = new Set(priorCovered);
  for (const entry of turnCalls.values()) {
    const res = validateCaptureToolCall(entry as MarkScreenshotParams, context);
    if (!res.ok) continue;
    for (const item of res.value.items) if (item.paragraph) union.add(item.paragraph);
  }
  return union;
}

/**
 * Registers the `mark_screenshot` tool for runs whose answer lands on an open screenshot.
 * Valid calls return `terminate: true` once required paragraph coverage is complete (or immediately
 * when full coverage is not required); incomplete probe/sequential calls keep the loop open and
 * guide the model toward the remaining paragraph ids.
 */
export function captureAnswerExtension(
  resolveRun: () => { ledger: Ledger; taskId: string; runId: string },
): ExtensionFactory {
  return (pi) => {
    const runs = new Map<string, RunCoverageState>();
    const stateFor = (runId: string): RunCoverageState => {
      let state = runs.get(runId);
      if (!state) {
        state = { covered: new Set(), stalls: 0, nudgedOnSettle: false };
        runs.set(runId, state);
      }
      return state;
    };
    let turnCalls = new Map<string, unknown>();
    let turnPriorCovered: Set<string> | null = null;
    let turnStallCounted = false;
    const resetTurn = () => {
      turnCalls = new Map();
      turnPriorCovered = null;
      turnStallCounted = false;
    };
    pi.on('before_agent_start', resetTurn);
    pi.on('turn_start', resetTurn);
    pi.on('tool_call', (event) => {
      if (event.toolName === CAPTURE_ANSWER_TOOL && !event.parentToolCallId)
        turnCalls.set(event.toolCallId, event.input);
    });
    pi.on('agent_before_settle', (event) => {
      if (event.outcome !== 'completed' || !event.context.canContinue) return undefined;
      const { ledger, taskId, runId } = resolveRun();
      const context = resolveCaptureRunContext(ledger, taskId, runId);
      if (!context?.requiresAllParagraphs) return undefined;
      const state = stateFor(runId);
      const missing = context.paragraphs.map((p) => p.id).filter((id) => !state.covered.has(id));
      if (missing.length === 0 || state.nudgedOnSettle) return undefined;
      state.nudgedOnSettle = true;
      return {
        entries: [
          ...event.entries,
          {
            type: 'custom_message',
            customType: 'app-capture-reminder',
            content: `This screenshot task requires \`${CAPTURE_ANSWER_TOOL}\` tool call(s) covering every paragraph. Missing paragraph(s): ${summarizeIds(missing)}. Deliver them via \`${CAPTURE_ANSWER_TOOL}\` now using bare paragraph ids (such as "${missing[0]}") with no conversational text.`,
            display: false,
          },
        ],
        continue: true,
      };
    });
    pi.registerTool({
      name: CAPTURE_ANSWER_TOOL,
      label: 'Mark screenshot',
      description:
        'Record structured replacements, numbered steps, highlights, mosaics, or visual shapes on the open screenshot. Call once or in parallel ordered batches in the same turn; for pure Q&A under annotate, do not call this tool and reply in plain text.',
      parameters: MarkScreenshotParamsSchema,
      executionMode: 'parallel',
      exposure: 'model-only',
      async execute(toolCallId, params, signal) {
        signal?.throwIfAborted();
        if (!turnCalls.has(toolCallId)) turnCalls.set(toolCallId, params);
        const { ledger, taskId, runId } = resolveRun();
        const context = resolveCaptureRunContext(ledger, taskId, runId);
        if (!context) {
          return {
            content: [{ type: 'text', text: 'Screenshot markup is not enabled for this run.' }],
            details: {},
            isError: true,
          };
        }
        const state = stateFor(runId);
        const priorCovered = (turnPriorCovered ??= new Set(state.covered));
        const validated = validateCaptureToolCall(params, context);
        if (!validated.ok) {
          return {
            content: [
              {
                type: 'text',
                text: formatValidationError(validated.error, context, priorCovered, turnCalls.size),
              },
            ],
            details: {},
            isError: true,
          };
        }
        const callIds = validated.value.items.flatMap((i) => (i.paragraph ? [i.paragraph] : []));
        for (const id of callIds) state.covered.add(id);
        const serialized = serializeCaptureAnswer(validated.value);
        if (!context.requiresAllParagraphs)
          return { content: [{ type: 'text', text: serialized }], details: {}, terminate: true };
        const turnUnion = collectTurnUnion(turnCalls, context, priorCovered);
        const missing = context.paragraphs.map((p) => p.id).filter((id) => !turnUnion.has(id));
        if (missing.length === 0) {
          state.stalls = 0;
          return { content: [{ type: 'text', text: serialized }], details: {}, terminate: true };
        }
        if (turnUnion.size > priorCovered.size) {
          state.stalls = 0;
          return {
            content: [
              {
                type: 'text',
                text: `${serialized}\nRecorded ${turnUnion.size}/${context.paragraphs.length} paragraphs. Remaining uncovered paragraphs: ${summarizeIds(missing)}. Call ${CAPTURE_ANSWER_TOOL} now for the remaining paragraphs without repeating already-recorded ones.`,
              },
            ],
            details: {},
          };
        }
        if (!turnStallCounted) {
          state.stalls += 1;
          turnStallCounted = true;
        }
        if (state.stalls <= 2) {
          return {
            content: [
              {
                type: 'text',
                text: `Paragraph(s) ${callIds.join(', ')} were already recorded in this run. Remaining uncovered paragraphs: ${summarizeIds(missing)}. Call ${CAPTURE_ANSWER_TOOL} only for those remaining paragraphs.`,
              },
            ],
            details: {},
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: serialized }], details: {}, terminate: true };
      },
    });
  };
}
