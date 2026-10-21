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
  parse,
} from '@atd/agent-contracts';

const ActionIds = Type.Array(ComputerActionIdSchema, { maxItems: COMPUTER_MAX_STATUS_IDS });
const ReasonSchema = Type.String({ minLength: 1, maxLength: 1000 });
const ResolvesSchema = Type.Array(ComputerActionIdSchema, { minItems: 1, maxItems: 20 });

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

/** What the model sees; providers need an object root, so the union above is flattened here. */
export const ComputerToolParametersSchema = Type.Object(
  {
    action: Type.Union(
      [
        Type.Literal('targets'),
        Type.Literal('requestAccess'),
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
          'shareScreen: requires reason and adds a macOS picker source for read-only sharing during this run, up to four sources. watchScreen: optional timeoutMs (default 10000, maximum 30000), waits for a changed source or sharing status. stopSharing: optional sourceId stops one selection; absent stops all system shares. These need no target or observation refs. requestAccess: request access to a specific target and open it in the background; requires target {kind: application, application: installed app name or bundle id} or {kind: website, url: http(s) URL}, and reason. Approval follows the task mode, then continues this run. targets: discover this run’s targets when the intended app or website is unknown. For a known requested target, start directly with requestAccess; it returns a first nextObservation when ready. observe requires targetRefId; optional surfaceRefId, tree, screenshot, text, region, afterMs. EVERY act requires targetRefId, observationRefId and steps, including read-only wait actions, and a postcondition when any step is an invoke or submit (see steps); optional surfaceRefId, resolves, actionId, recipeStepId, reason. No act field picks a route or the foreground: the host decides how each step is delivered. status accepts actionIds. release requires targetRefId.',
      },
    ),
    target: Type.Optional(ComputerAccessTargetSchema),
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
        'For act only; omit this field from observe. REQUIRED for EVERY act, even wait or capture-point clicks: observationRefId from the latest observe, requestAccess.nextObservation or act.nextObservation. Inspect the returned inline nextObservation image and use it directly; no extra preparatory observe is needed. Never omit it or reuse one from another run.',
    }),
    actionId: Type.Optional({
      ...ComputerActionIdSchema,
      description: 'act: a UUID for the action; repeating it returns the first result.',
    }),
    steps: Type.Optional(
      Type.Array(ComputerModelStepSchema, {
        minItems: 1,
        maxItems: COMPUTER_MAX_STEPS,
        description:
          'act: the steps, carried out in order, each in the background or, when no background route can and the task allows it, in the foreground; the host decides. A step’s kind sets its effect: every click (any locator), menu, drag and upload, a key other than plain typing or navigation keys and typed text with a line break are invoke; press takes its own effect, where submit is a submit and click is not; the other kinds are input, navigate or read. An act with any invoke or submit step needs a postcondition.',
      }),
    ),
    postcondition: Type.Optional({
      ...ComputerConditionSchema,
      description:
        'Required when any step is an invoke or submit: a click (element ref, semantic locator, {text} or capture point), menu, drag, upload, key other than plain typing or navigation keys, typed line break, or press with effect submit. Proves this act’s immediate change, not the entire user request: navigation checks the destination opened, then later input is chosen from nextObservation. For navigation, name text the destination is sure to show, preferring a control it always offers over its title; never a label recalled from another app version or a variant of a title already on screen. Expected result text/menu labels may be absent from the baseline; only input targets must already be observed. Native textAppears is a visible-text substring check ignoring case and spacing; on an app, a submit/invoke textAppears whose text this act’s observation already shows anywhere (an element name or value, or recognized text) is refused. menuItemAvailable checks an exact resulting menu path is present and enabled without invoking it. Use newText only for a new value whose text is unknown, with no locator for OCR. Its optional region {capture,rect} uses this act’s full capture; available in interactive tasks, not automation runs. On an app, a submit/invoke newText needs a locator, pattern or region; one with none is refused. Existing labels, enabled controls and unrelated changes are not proof. A locator names an accessibility element, never an OCR box.',
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

/** Validate the selected action, so another union branch cannot hide its missing fields. */
export function parseComputerCall(value: unknown): ComputerCall {
  const head = parse(
    Type.Object({ action: ComputerToolParametersSchema.properties.action }),
    value,
  );
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
