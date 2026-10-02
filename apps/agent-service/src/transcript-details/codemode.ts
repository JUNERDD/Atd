import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';
import {
  CODEMODE_MAX_STEPS,
  CODEMODE_STEP_OUTPUT_MAX_LENGTH,
  CodemodeStepDetailsSchema,
  type CodemodeDetails,
  type CodemodeStep,
  type CodemodeStepStatus,
  type GrantScope,
  type PermissionOutcome,
  type ServiceToolStatus,
} from '@atd/agent-contracts';
import { createClamp, isRecord } from './clamp.js';

/**
 * Rows of a `codemode` call. pi runs a script's `tools.<name>()` calls through the session's tool
 * pipeline but persists only a bounded record of them (`nestedCalls`) and none of their results,
 * so the service keeps its own step list (codemode/steps.ts): live while the call runs, and in the
 * call's result details once it ended (codemode/extension.ts). pi's own records (`details.calls`,
 * `nestedCalls`) fill in calls the step list missed, such as calls that failed validation and so
 * never reached the service's hooks.
 */

/** One nested call as the service records it; the projection adds permission and final status. */
export const StoredStepSchema = Type.Object({
  id: Type.String({ maxLength: 512 }),
  name: Type.String({ maxLength: 128 }),
  args: Type.Record(Type.String(), Type.Unknown()),
  status: Type.Union([Type.Literal('running'), Type.Literal('completed'), Type.Literal('failed')]),
  durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
  output: Type.String({ maxLength: CODEMODE_STEP_OUTPUT_MAX_LENGTH }),
  details: Type.Optional(CodemodeStepDetailsSchema),
});
export type StoredStep = Static<typeof StoredStepSchema>;

/** A call's steps in start order; `truncated` when steps, arguments or output were dropped. */
export interface StepList {
  steps: StoredStep[];
  truncated: boolean;
}

/** What codemode/extension.ts leaves in a finished call's result details, beside pi's `calls`. */
const StoredDetailsValidator = Compile(
  Type.Object({ steps: Type.Array(StoredStepSchema), stepsTruncated: Type.Boolean() }),
);

/** One entry of pi's `CodemodeToolDetails.calls`: a call the script started, its args previewed. */
const PiCallSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  args: Type.String(),
  status: Type.String(),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  error: Type.Optional(Type.String()),
});
type PiCall = Static<typeof PiCallSchema>;
const PiCallsValidator = Compile(Type.Object({ calls: Type.Array(PiCallSchema) }));

export interface CodemodeDetailsInput {
  /** The codemode call's own status. */
  status: ServiceToolStatus;
  /** The call's result once it ended. */
  result: ToolResultMessage | undefined;
  /** The steps of a running call (live-transcript.ts); unused once the result exists. */
  live: StepList | undefined;
  /** Recorded permission outcomes by tool call id; nested calls record theirs under their own. */
  permissions: ReadonlyMap<string, { scope: GrantScope; outcome: PermissionOutcome }>;
}

export function projectCodemodeDetails(input: CodemodeDetailsInput): CodemodeDetails {
  const clamp = createClamp();
  const { steps, truncated } = sourceSteps(input);
  if (truncated) clamp.drop();
  const projected = clamp.list(steps, CODEMODE_MAX_STEPS).map((step) => {
    const permission = input.permissions.get(step.id);
    const out: CodemodeStep = {
      id: clamp.text(step.id, 512),
      name: clamp.text(step.name, 128),
      // A copy: the live step list keeps changing, and published blocks must not change with it.
      args: { ...step.args },
      status: stepStatus(step.status, permission?.outcome, input.status),
      output: clamp.text(step.output, CODEMODE_STEP_OUTPUT_MAX_LENGTH),
    };
    if (step.durationMs !== undefined) out.durationMs = step.durationMs;
    if (permission) out.permission = { scope: permission.scope, outcome: permission.outcome };
    if (step.details) out.details = step.details;
    return out;
  });
  return { type: 'codemode', steps: projected, truncated: clamp.truncated };
}

/** The settled result's steps merged with pi's records, or the live steps while it runs. */
function sourceSteps(input: CodemodeDetailsInput): StepList {
  const { result } = input;
  if (!result) return input.live ?? { steps: [], truncated: false };
  const raw = result.details;
  const stored = StoredDetailsValidator.Check(raw)
    ? { steps: raw.steps, truncated: raw.stepsTruncated }
    : { steps: [], truncated: false };
  if (!PiCallsValidator.Check(raw)) return stored;
  const byId = new Map(stored.steps.map((step) => [step.id, step]));
  const args = new Map((result.nestedCalls?.calls ?? []).map((call) => [call.id, call.arguments]));
  const merged = raw.calls.map((call) => {
    const step = byId.get(call.id);
    // A call the hooks saw start but not end (a blocked call) takes pi's final status.
    if (step?.status === 'running' && piStatus(call.status) !== 'running')
      return { ...step, status: piStatus(call.status), output: call.error ?? '' };
    return step ?? fromPiCall(call, args.get(call.id));
  });
  const listed = new Set(raw.calls.map((call) => call.id));
  return {
    steps: [...merged, ...stored.steps.filter((step) => !listed.has(step.id))],
    truncated: stored.truncated || result.nestedCalls?.complete === false,
  };
}

/** A step from pi's record alone; its arguments come from `nestedCalls` or the preview. */
function fromPiCall(call: PiCall, recorded: unknown): StoredStep {
  return {
    id: call.id,
    name: call.name,
    args: isRecord(recorded) ? recorded : previewArgs(call.args),
    status: piStatus(call.status),
    ...(call.durationMs === undefined ? {} : { durationMs: Math.round(call.durationMs) }),
    output: call.error ?? '',
  };
}

/** pi's 200-character argument preview, when it is whole JSON of an object. */
function previewArgs(preview: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(preview);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * pi's call status (`ok`, `error`, `cancelled`, `running`) as a stored step status. A cancelled
 * call was cut off by the end of its script, so it stays unfinished and reads as interrupted.
 */
function piStatus(status: string): StoredStep['status'] {
  if (status === 'ok') return 'completed';
  if (status === 'running' || status === 'cancelled') return 'running';
  return 'failed';
}

/** A declined call reads as declined; a call still running when its script ended was cut off. */
function stepStatus(
  status: StoredStep['status'],
  outcome: PermissionOutcome | undefined,
  parent: ServiceToolStatus,
): CodemodeStepStatus {
  if (outcome === 'declined') return 'declined';
  if (status !== 'running') return status;
  return parent === 'running' ? 'running' : 'interrupted';
}
