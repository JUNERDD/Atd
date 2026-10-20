import { Value } from 'typebox/value';
import {
  ComputerStepKindSchema,
  type ActionResult,
  type ComputerDetails,
  type ComputerProgress,
  type ComputerStepKind,
} from '@atd/agent-contracts';
import type { BlockOf } from '../../../client/agent/transcript-schema';

/**
 * Reading of a `computer` call. The one tool lists targets, looks at one, acts on it, checks
 * earlier actions and lets a target go, so its row reads by the operation: from the projected
 * details once the call settled, from the model's arguments before. While an action runs, the
 * host's live progress names its phase; the result alone says what took effect, and an unknown
 * result never reads as done.
 */

export type ComputerOp = ComputerDetails['op'];

/** Settled rows: what the call did, like every other tool's label. */
export type ComputerStepKey =
  | 'computer.step.requestAccess'
  | 'computer.step.shareScreen'
  | 'computer.step.watchScreen'
  | 'computer.step.stopSharing'
  | 'computer.step.targets'
  | 'computer.step.observe'
  | 'computer.step.act'
  | 'computer.step.fill'
  | 'computer.step.type'
  | 'computer.step.clear'
  | 'computer.step.key'
  | 'computer.step.menu'
  | 'computer.step.drag'
  | 'computer.step.select'
  | 'computer.step.upload'
  | 'computer.step.click'
  | 'computer.step.submit'
  | 'computer.step.navigate'
  | 'computer.step.scroll'
  | 'computer.step.wait'
  | 'computer.step.status'
  | 'computer.step.release';

/** Running rows: what is happening now. */
export type ComputerLiveKey =
  | 'computer.live.requestingAccess'
  | 'computer.live.sharingScreen'
  | 'computer.live.watchingScreen'
  | 'computer.live.stoppingShare'
  | 'computer.live.finding'
  | 'computer.live.viewing'
  | 'computer.live.filling'
  | 'computer.live.typing'
  | 'computer.live.clearing'
  | 'computer.live.pressingKey'
  | 'computer.live.choosingMenu'
  | 'computer.live.dragging'
  | 'computer.live.selecting'
  | 'computer.live.uploading'
  | 'computer.live.clicking'
  | 'computer.live.submitting'
  | 'computer.live.opening'
  | 'computer.live.waitingCompletion'
  | 'computer.live.verifying'
  | 'computer.live.waitingTarget'
  | 'computer.live.checking'
  | 'computer.live.releasing'
  | 'computer.live.stopping';

/** How an action turned out, in the words the row and its detail use. */
export type ComputerOutcome = 'verified' | 'partial' | 'unknown' | 'notDispatched' | 'none';

const OPS: readonly ComputerOp[] = [
  'requestAccess',
  'shareScreen',
  'watchScreen',
  'stopSharing',
  'targets',
  'observe',
  'act',
  'status',
  'release',
];

/** The projected details of a settled call, if the service recorded them. */
export function computerDetails(block: BlockOf<'tool'>): ComputerDetails | null {
  const data = block.details.data;
  return data?.type === 'computer' ? data : null;
}

/**
 * Whether a call's details hold anything its card shows: an outcome, the refusal of another
 * operation, steps, a saved view or the visual-steps note. Details without any of them would draw
 * an empty card.
 */
export function computerHasDetail(data: ComputerDetails): boolean {
  return Boolean(
    data.result ||
    data.error ||
    data.steps.length > 0 ||
    data.resourceIds.length > 0 ||
    computerVisualOff(data),
  );
}

/** An observation's note that visual steps are off for the run's model, if they are. */
export function computerVisualOff(data: ComputerDetails): 'unverified' | 'unavailable' | null {
  if (data.op !== 'observe') return null;
  return data.visual === 'unverified' || data.visual === 'unavailable' ? data.visual : null;
}

/** The call's operation: its details', else its arguments' when they name one. */
export function computerOp(block: BlockOf<'tool'>): ComputerOp | null {
  const details = computerDetails(block);
  if (details) return details.op;
  const op = block.args.action ?? block.args.op;
  return OPS.find((item) => item === op) ?? null;
}

interface StepFacts {
  kind: ComputerStepKind;
  effect?: string;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The action's steps: as the details summarize them, else as the arguments list them. */
function stepFacts(block: BlockOf<'tool'>): StepFacts[] {
  const details = computerDetails(block);
  if (details) return details.steps;
  const raw = block.args.steps ?? record(block.args.action)?.steps;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown): StepFacts[] => {
    const step = record(item);
    if (!step || !Value.Check(ComputerStepKindSchema, step.kind)) return [];
    const { kind, effect } = step;
    return [{ kind, ...(typeof effect === 'string' ? { effect } : {}) }];
  });
}

/** Steps that write text into a field, which name an action that has no business step. */
const TEXT_KINDS: readonly ComputerStepKind[] = ['fill', 'setValue', 'type', 'clear'];

/**
 * The step that names an action: its business step if any (a submit, or an `invoke` whose effect
 * is unknown), else its last text write, else its last.
 */
function leadStep(steps: readonly StepFacts[]): StepFacts | null {
  return (
    steps.find((step) => step.effect === 'submit' || step.effect === 'invoke') ??
    steps.findLast((step) => TEXT_KINDS.includes(step.kind)) ??
    steps.at(-1) ??
    null
  );
}

/** The settled label of a step kind; it never repeats the text a step types. */
function actKey(step: StepFacts | null): ComputerStepKey {
  switch (step?.kind) {
    case 'fill':
    case 'setValue':
      return 'computer.step.fill';
    case 'type':
      return 'computer.step.type';
    case 'clear':
      return 'computer.step.clear';
    case 'key':
      return 'computer.step.key';
    case 'menu':
      return 'computer.step.menu';
    case 'drag':
      return 'computer.step.drag';
    case 'select':
      return 'computer.step.select';
    case 'upload':
      return 'computer.step.upload';
    case 'click':
      return 'computer.step.click';
    case 'press':
      return step.effect === 'submit' ? 'computer.step.submit' : 'computer.step.click';
    case 'navigate':
      return 'computer.step.navigate';
    case 'scroll':
      return 'computer.step.scroll';
    case 'wait':
      return 'computer.step.wait';
    case undefined:
      return 'computer.step.act';
  }
}

/** The settled row's label. */
export function computerStepKey(block: BlockOf<'tool'>): ComputerStepKey {
  switch (computerOp(block)) {
    case 'requestAccess':
      return 'computer.step.requestAccess';
    case 'shareScreen':
      return 'computer.step.shareScreen';
    case 'watchScreen':
      return 'computer.step.watchScreen';
    case 'stopSharing':
      return 'computer.step.stopSharing';
    case 'targets':
      return 'computer.step.targets';
    case 'observe':
      return 'computer.step.observe';
    case 'status':
      return 'computer.step.status';
    case 'release':
      return 'computer.step.release';
    case 'act':
    case null:
      return actKey(leadStep(stepFacts(block)));
  }
}

function liveStepKey(
  kind: ComputerStepKind | undefined,
  steps: readonly StepFacts[],
): ComputerLiveKey {
  const step = kind ? (steps.find((item) => item.kind === kind) ?? { kind }) : leadStep(steps);
  switch (step?.kind) {
    case 'fill':
    case 'setValue':
      return 'computer.live.filling';
    case 'type':
      return 'computer.live.typing';
    case 'clear':
      return 'computer.live.clearing';
    case 'key':
      return 'computer.live.pressingKey';
    case 'menu':
      return 'computer.live.choosingMenu';
    case 'drag':
      return 'computer.live.dragging';
    case 'select':
      return 'computer.live.selecting';
    case 'upload':
      return 'computer.live.uploading';
    case 'click':
      return 'computer.live.clicking';
    case 'press':
      return step.effect === 'submit' ? 'computer.live.submitting' : 'computer.live.clicking';
    case 'navigate':
      return 'computer.live.opening';
    case 'wait':
      return 'computer.live.waitingCompletion';
    case 'scroll':
    case undefined:
      return 'computer.live.viewing';
  }
}

/**
 * The running row's label. An action reads by the host's phase once it reports one; before the
 * first frame it waits for its target, which another run or a person may be using. `stopping`:
 * the run is stopping, which the row keeps saying until the call actually settles.
 */
export function computerLiveKey(
  block: BlockOf<'tool'>,
  progress: ComputerProgress | null,
  stopping: boolean,
): ComputerLiveKey {
  if (stopping) return 'computer.live.stopping';
  switch (computerOp(block)) {
    case 'requestAccess':
      return 'computer.live.requestingAccess';
    case 'shareScreen':
      return 'computer.live.sharingScreen';
    case 'watchScreen':
      return 'computer.live.watchingScreen';
    case 'stopSharing':
      return 'computer.live.stoppingShare';
    case 'targets':
      return 'computer.live.finding';
    case 'observe':
      return 'computer.live.viewing';
    case 'status':
      return 'computer.live.checking';
    case 'release':
      return 'computer.live.releasing';
    case 'act':
    case null:
      break;
  }
  if (!progress) return 'computer.live.waitingTarget';
  switch (progress.phase) {
    case 'waiting':
      return 'computer.live.waitingCompletion';
    case 'verifying':
      return 'computer.live.verifying';
    case 'locating':
    case 'dispatching':
    case 'done':
    case 'failed':
    case 'cleared':
      return liveStepKey(progress.label, stepFacts(block));
  }
}

/**
 * What an action's result says took effect; never `verified` without the host's check. A read-only
 * action whose postcondition held reads `verified` although it dispatched nothing.
 */
export function computerOutcome(result: ActionResult): ComputerOutcome {
  if (result.effect === 'verified') return 'verified';
  if (result.dispatch === 'not_dispatched') return 'notDispatched';
  switch (result.effect) {
    case 'partial':
      return 'partial';
    case 'unknown':
      return 'unknown';
    case 'none':
      return 'none';
  }
}

/**
 * The tone an outcome reads in: an effect that may have happened unchecked reads as a warning, and
 * the rest in the detail's plain text, since a success says nothing in a status color.
 */
export function outcomeTone(outcome: ComputerOutcome): 'warning' | null {
  switch (outcome) {
    case 'partial':
    case 'unknown':
      return 'warning';
    case 'verified':
    case 'notDispatched':
    case 'none':
      return null;
  }
}
