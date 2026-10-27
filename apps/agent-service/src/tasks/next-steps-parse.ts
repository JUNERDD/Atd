import { randomUUID } from 'node:crypto';
import { Compile } from 'typebox/compile';
import {
  MAX_NEXT_STEP_FOLLOW_UPS,
  MAX_NEXT_STEPS,
  NextStepSchema,
  type MessageUsage,
  type NextStep,
  type NextStepKind,
} from '@atd/agent-contracts';

const NextStepValidator = Compile(NextStepSchema);

/** How many suggestions of each kind one run keeps, in the order the card lists them. */
const KIND_LIMITS: readonly (readonly [NextStepKind, number])[] = [
  ['continue', MAX_NEXT_STEP_FOLLOW_UPS],
  ['newTask', 1],
  ['automation', 1],
];

const LABEL_CHARS = 80;
const PROMPT_CHARS = 4000;
const REASON_CHARS = 160;

/**
 * Turns a suggestion reply into valid steps. The reply may wrap its JSON in a Markdown fence or
 * stray text; a reply without a readable object throws, while each step that fails the contract
 * is dropped alone. Steps keep their kind's limit (follow-ups first), an automation needs a
 * schedule and a name no saved automation has, and repeats of one label count once.
 */
export function parseNextSteps(text: string, automations: readonly string[]): NextStep[] {
  const reply = replyObject(text);
  const raw = Array.isArray(reply.steps) ? reply.steps : [];
  const taken = new Set(automations.map(labelKey));
  const steps = raw.flatMap((item: unknown) => {
    const step = nextStep(item);
    if (!step || taken.has(labelKey(step.label))) return [];
    taken.add(labelKey(step.label));
    return [step];
  });
  return KIND_LIMITS.flatMap(([kind, limit]) =>
    steps.filter((step) => step.kind === kind).slice(0, limit),
  ).slice(0, MAX_NEXT_STEPS);
}

/** The outermost braces of the reply, so a Markdown fence or a stray sentence around them is ignored. */
function replyObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The suggestion reply held no JSON object.');
  const value: unknown = JSON.parse(text.slice(start, end + 1));
  if (!isRecord(value)) throw new Error('The suggestion reply was not a JSON object.');
  return value;
}

/** One reply step as the contract stores it, or null when it cannot be one. */
function nextStep(item: unknown): NextStep | null {
  if (!isRecord(item)) return null;
  const { kind } = item;
  if (kind !== 'continue' && kind !== 'newTask' && kind !== 'automation') return null;
  const label = clipText(item.label, LABEL_CHARS, true);
  const prompt = clipText(item.prompt, PROMPT_CHARS, false);
  if (!label || !prompt) return null;
  const step: NextStep = {
    id: randomUUID(),
    kind,
    label,
    prompt,
    reason: clipText(item.reason, REASON_CHARS, true),
  };
  if (kind === 'automation') {
    const schedule = weeklySchedule(item.schedule);
    if (!schedule) return null;
    step.schedule = schedule;
  }
  return NextStepValidator.Check(step) ? step : null;
}

/** A weekly schedule with its days in order and repeats removed; the contract judges the rest. */
function weeklySchedule(value: unknown): NextStep['schedule'] {
  if (!isRecord(value) || !Array.isArray(value.days) || typeof value.time !== 'string')
    return undefined;
  const days = [...new Set<unknown>(value.days)];
  if (!days.every((day): day is number => typeof day === 'number')) return undefined;
  return { days: days.sort((a, b) => a - b), time: value.time.trim() };
}

/** A trimmed string clipped to `limit`, on one line when `line`; empty when not a string. */
function clipText(value: unknown, limit: number, line: boolean): string {
  if (typeof value !== 'string') return '';
  const trimmed = (line ? value.replace(/\s+/g, ' ') : value).trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1).trimEnd()}…`;
}

function labelKey(label: string): string {
  return label.trim().toLocaleLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A request that failed after the provider reported what it used, which still counts. */
export class UsedRequestError extends Error {
  constructor(
    message: string,
    readonly usage: MessageUsage | undefined,
  ) {
    super(message);
  }
}
