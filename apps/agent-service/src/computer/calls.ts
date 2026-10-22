import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  COMPUTER_MAX_STATUS_IDS,
  COMPUTER_MAX_STEPS,
  ComputerActionIdSchema,
  ComputerAccessTargetSchema,
  ComputerActionInputSchema,
  ComputerConditionSchema,
  ComputerObserveRegionSchema,
  ComputerRefIdSchema,
  ComputerModelStepSchema,
  ComputerStepIdSchema,
  ScreenCursorSchema,
  isBusinessEffect,
  parse,
  stepEffect,
} from '@atd/agent-contracts';
import { computerActRequirements, computerModelSteps } from './model-schema.js';
import { visualState, type VisualSubject } from './visual-qualifications.js';

const ActionIds = Type.Array(ComputerActionIdSchema, { maxItems: COMPUTER_MAX_STATUS_IDS });
const ReasonSchema = Type.String({ minLength: 1, maxLength: 1000 });
const ResolvesSchema = Type.Array(ComputerActionIdSchema, { minItems: 1, maxItems: 20 });
const AccessWaitSchema = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 200 }),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
  },
  { additionalProperties: false },
);
const CompletionSchema = Type.String({ minLength: 1, maxLength: 1000 });

/** The validated call: one variant per action, each with exactly its own fields. */
const ComputerCallSchema = Type.Union([
  Type.Object(
    { action: Type.Literal('shareScreen'), reason: ReasonSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('watchScreen'),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 30_000 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('stopSharing'),
      sourceId: Type.Optional(ScreenCursorSchema.properties.sourceId),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('requestAccess'),
      target: ComputerAccessTargetSchema,
      reason: ReasonSchema,
      waitFor: Type.Optional(AccessWaitSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object({ action: Type.Literal('targets') }, { additionalProperties: false }),
  Type.Object(
    {
      action: Type.Literal('observe'),
      targetRefId: ComputerRefIdSchema,
      surfaceRefId: Type.Optional(ComputerRefIdSchema),
      tree: Type.Optional(Type.Boolean()),
      screenshot: Type.Optional(Type.Boolean()),
      text: Type.Optional(Type.Boolean()),
      region: Type.Optional(ComputerObserveRegionSchema),
      afterMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 5000 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('act'),
      ...ComputerActionInputSchema.properties,
      reason: Type.Optional(ReasonSchema),
      completion: Type.Optional(CompletionSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('status'), actionIds: Type.Optional(ActionIds) },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('release'), targetRefId: ComputerRefIdSchema },
    { additionalProperties: false },
  ),
]);

export type ComputerCall = Static<typeof ComputerCallSchema>;

/** Shared model fields; providers need an object root, with action constraints added below. */
const ComputerToolParametersBase = Type.Object(
  {
    action: Type.Union(
      [
        Type.Literal('requestAccess'),
        Type.Literal('targets'),
        Type.Literal('observe'),
        Type.Literal('act'),
        Type.Literal('status'),
        Type.Literal('release'),
        Type.Literal('shareScreen'),
        Type.Literal('watchScreen'),
        Type.Literal('stopSharing'),
      ],
      {
        description:
          'requestAccess: resolve and open an app by name/bundle ID or a website by URL with approval; requires target and reason, optional waitFor. Returns current targets and nextObservation. targets: refresh references for targets already authorized in this run; never discovers installed apps. observe: read targetRefId, optionally surfaceRefId/tree/screenshot/text/region/afterMs. act: targetRefId + observationRefId + steps, postcondition for invoke/submit; optional resolves, actionId, recipeStepId, reason. Every call requires completion: null or the final answer to publish IF this act verifies the remaining goal. Host chooses delivery. status: optional actionIds. release: targetRefId. shareScreen: reason; macOS picker, read-only, up to four shares. watchScreen: timeoutMs. stopSharing: sourceId or all shares when omitted.',
      },
    ),
    target: Type.Optional(ComputerAccessTargetSchema),
    waitFor: Type.Optional({
      ...AccessWaitSchema,
      description:
        'requestAccess: wait for a known entry/control text before returning the first observation, useful when opening an app that may still load. Choose text from the requested destination or a known control, not a guessed page title. Default timeout 5000 ms, maximum 10000. Returns the latest observation and readiness even on timeout; sends no input.',
    }),
    completion: Type.Union([CompletionSchema, Type.Null()], {
      description:
        'Required decision before input. When current content identifies the requested target and this act will prove the remaining result, include the brief conditional answer on this SAME act with its absolute postcondition. The result is expected after input; the host publishes only after verification. Use null for non-act, intermediate actions, uncertainty or further work. Never use completion for newText, enabled or facts unsupported by current content and the declared postcondition. An already verified goal needs no extra wait or observe.',
    }),
    sourceId: Type.Optional({
      ...ScreenCursorSchema.properties.sourceId,
      description:
        'stopSharing only: sourceId from this run’s shared sources. Omit to stop all system shares.',
    }),
    reason: Type.Optional({
      ...ReasonSchema,
      description:
        'requestAccess/shareScreen: required purpose. act: optional descriptive metadata only; it never changes authorization or action behavior. Other actions do not accept reason.',
    }),
    targetRefId: Type.Optional({
      ...ComputerRefIdSchema,
      description: 'A targetRefId returned by requestAccess, targets or a nextObservation.',
    }),
    surfaceRefId: Type.Optional({
      ...ComputerRefIdSchema,
      description:
        "observe/act: a surface (sheet, dialog, panel, menu, owned window) from the observation's surfaces; absent is the target's main window.",
    }),
    tree: Type.Optional(
      Type.Boolean({ description: 'observe: read the accessibility tree (default true).' }),
    ),
    screenshot: Type.Optional(
      Type.Boolean({
        description:
          'observe: also capture a screenshot, attached for image-capable models and saved as a task file (default true for applications; implied by region).',
      }),
    ),
    text: Type.Optional(
      Type.Boolean({
        description:
          'observe: also recognize text boxes on the screenshot (default true for application screenshots).',
      }),
    ),
    region: Type.Optional({
      ...ComputerObserveRegionSchema,
      description:
        'observe: recapture only this rectangle, in pixels of an earlier capture of the same target. The rectangle must fit that capture’s width and height. Coordinates of a cropped capture start at 0,0 inside the crop.',
    }),
    afterMs: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 5000,
        description:
          'observe: delay this fresh observation by up to 5000 ms, for comparing changing state such as playback progress. Use this instead of waiting for an invented condition.',
      }),
    ),
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 30_000,
        description:
          'watchScreen: wait up to this many milliseconds for a changed picture or sharing status (default 10000, maximum 30000).',
      }),
    ),
    observationRefId: Type.Optional({
      ...ComputerRefIdSchema,
      description:
        'For act only; omit this field from observe. REQUIRED for EVERY act, even wait or capture-point clicks: observationRefId from the latest observe, requestAccess.nextObservation or act.nextObservation. Inspect and use a ready nextObservation directly; refresh with observe when it is missing, still loading, incomplete for the next action or contradictory. Never omit it or reuse one from another run.',
    }),
    actionId: Type.Optional({
      ...ComputerActionIdSchema,
      description:
        'act: omit for a new action; the service generates a fresh UUID. Reuse an existing actionId only to retrieve that same action’s recorded result; the service does not dispatch its steps again.',
    }),
    steps: Type.Optional(
      Type.Array(ComputerModelStepSchema, {
        minItems: 1,
        maxItems: COMPUTER_MAX_STEPS,
        description:
          'act: ordered steps; host chooses background/foreground delivery. Prefer observed element refs; native OCR entries expose ocr: refs usable only by click/drag, matched to the same observed text box in fresh pixels; stale geometry is refused. Never invent or extend text. press requires an accessibility element. Every click/menu/drag/upload, shortcut or invoke key, and typed line break needs a postcondition; press effect submit also needs one. Other kinds retain their declared effects.',
      }),
    ),
    postcondition: Type.Optional({
      ...ComputerConditionSchema,
      description:
        'Required for invoke/submit. Prove this action’s immediate change: menuItemAvailable for exact resulting app state, valueEquals/urlMatches where applicable, textAppears only for reliable destination text absent from the baseline. Never guess future titles or variants. When navigation wording is unknown, use newText.region without a pattern over the destination content area; never add a literal pattern already present in the baseline. The host already polls native text changes for about 3 seconds and menu state for about 8 seconds; an extra same-condition wait is only for a known longer transition. Inspect nextObservation before later input. Region changes cannot finish the task. Native textAppears ignores case/spacing; already visible text or an already enabled menu item is refused. Playback: when baseline Play becomes Pause, verify the exact Pause menu path, not a title or OCR icon. newText uses this act’s full capture region, an element locator or pattern; bare native newText is refused. OCR refs are not condition locators. A failed newText cannot be rebased. Expected result text/menu labels may be absent; input targets must be observed.',
    }),
    resolves: Type.Optional({
      ...ResolvesSchema,
      description:
        'act: unresolved actions on this task and target to recheck with read-only steps. Must repeat their originally recorded absolute postcondition on the same surface. Cannot replace it with easier text or rebase newText onto a later observation.',
    }),
    recipeStepId: Type.Optional({
      ...ComputerStepIdSchema,
      description: 'act: the recipe step carried out, required when the run follows a recipe.',
    }),
    actionIds: Type.Optional({ ...ActionIds, description: 'status: actions to check.' }),
  },
  { additionalProperties: false },
);

/** Access changes keep this declaration stable; parsing and live policy enforce authorization. */
export function computerToolParameters(
  subject: VisualSubject | undefined,
  visualOverride: boolean,
  recipeBound = false,
) {
  const visual = subject ? visualState(subject) : 'unavailable';
  const capturePoints = visual === 'qualified' || (visual === 'unverified' && visualOverride);
  const properties = ComputerToolParametersBase.properties;
  const { action } = properties;
  return Type.Object(
    {
      ...properties,
      action,
      steps: Type.Optional({ ...properties.steps, items: computerModelSteps(capturePoints) }),
    },
    {
      additionalProperties: false,
      // A recipe supplies its own postcondition in policy; free acts must declare theirs.
      ...(recipeBound
        ? {}
        : {
            anyOf: computerActRequirements(Type.Exclude(action, Type.Literal('act'))),
          }),
    },
  );
}

/** Before the session model is known, never advertise capture-point input. */
export const ComputerToolParametersSchema = computerToolParameters(undefined, false);

/** Pi validates prepared arguments against the model schema before execution. */
export function prepareComputerCall(
  value: unknown,
  recipeBound = false,
): Static<typeof ComputerToolParametersSchema> {
  const call = parseComputerCall(value);
  // Explain the failed requirement before Pi reports unrelated action constants from anyOf.
  // Recipe policy supplies its own condition; only free acts must declare one here.
  if (call.action === 'act' && !recipeBound && !call.postcondition) {
    const businessKinds = [
      ...new Set(
        call.steps.filter((step) => isBusinessEffect(stepEffect(step))).map((step) => step.kind),
      ),
    ];
    if (businessKinds.length > 0)
      throw new TypeError(
        `Missing required field postcondition for computer act with ${businessKinds.join('/')} steps (invoke/submit). The action:"act" value is valid. Nothing was sent. Add a postcondition that verifies the intended result; observe first if current evidence is insufficient. Never invent a condition.`,
      );
  }
  // Internal dispatch omits null; the model schema requires the explicit decision. Legacy
  // omissions normalize to null without making that field optional in model declarations.
  return { ...call, completion: call.action === 'act' ? (call.completion ?? null) : null };
}

/** Validate the selected action, so another union branch cannot hide its missing fields. */
export function parseComputerCall(value: unknown): ComputerCall {
  // A quoted null is also non-final: treating that sentinel as an answer could end a run.
  // Other summaries still belong only to act and are rejected on every other action.
  if (
    value &&
    typeof value === 'object' &&
    'completion' in value &&
    (value.completion === null ||
      (typeof value.completion === 'string' && value.completion.trim() === 'null'))
  ) {
    const { completion: _completion, ...parameters } = value;
    void _completion;
    value = parameters;
  }
  const header = Type.Object({ action: ComputerToolParametersSchema.properties.action });
  if (!Value.Check(header, value)) {
    const actions = ComputerCallSchema.anyOf.map((schema) => schema.properties.action.const);
    throw new TypeError(
      `Invalid computer action. Use one literal action name: ${actions.join(', ')}. Put the other call fields alongside action. Do not encode a JSON call inside action. Nothing was sent.`,
    );
  }
  const head = parse(header, value);
  const schema = ComputerCallSchema.anyOf.find(
    (candidate) => candidate.properties.action.const === head.action,
  );
  if (!schema) throw new TypeError('Unknown computer action.');
  if (Value.Check(schema, value)) return parse(ComputerCallSchema, value);
  const missing = schema.required?.filter((key) => !Object.hasOwn(head, key)) ?? [];
  const issue = [...Value.Errors(schema, value)][0];
  const detail = missing.length
    ? `missing required field(s): ${missing.join(', ')}`
    : `${issue?.instancePath ?? '/'} ${issue?.message ?? 'invalid parameters'}`;
  const allowed = Object.keys(schema.properties).join(', ');
  throw new TypeError(
    `Invalid computer ${head.action}: ${detail}. Allowed fields: ${allowed}. Remove fields belonging to another action. Nothing was sent.`,
  );
}
