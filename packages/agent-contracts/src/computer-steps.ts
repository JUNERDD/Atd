import { Type, type Static } from 'typebox';
import {
  COMPUTER_MAX_STEPS,
  COMPUTER_TEXT_MAX_LENGTH,
  COMPUTER_WAIT_MAX_MS,
  ComputerActionIdSchema,
  ComputerRefIdSchema,
  ComputerStepIdSchema,
  ComputerUrlSchema,
  type ComputerEffect,
} from './computer-actions.js';
import { ComputerKeyNameSchema, ComputerModifierSchema, isPlainKeyInput } from './computer-keys.js';
import { Identifier } from './identifiers.js';
import {
  ComputerConditionSchema,
  ComputerElementLocatorSchema,
  ComputerPointLocatorSchema,
  isImagePoint,
  type ComputerPointLocator,
} from './computer-locators.js';

/**
 * The registered steps and the action that carries them. A step's effect follows from its kind
 * and parameters (`stepEffect`); only `press` names one, choosing between `click` and `submit`,
 * which the confirm shows and a recipe pins. The model can never lower an effect this file
 * derives.
 */

/** Text a `fill`, `setValue` or `type` step inserts: never empty (`clear` empties a field). */
const StepText = Type.String({ minLength: 1, maxLength: COMPUTER_TEXT_MAX_LENGTH });

/** Task files one `upload` step sets on a file input. */
export const COMPUTER_MAX_UPLOAD_FILES = 5;

/** The fields of an `upload` step the model supplies: the input and the task's resource ids. */
const uploadFields = {
  kind: Type.Literal('upload'),
  locator: ComputerElementLocatorSchema,
  resourceIds: Type.Array(Identifier, {
    minItems: 1,
    maxItems: COMPUTER_MAX_UPLOAD_FILES,
    uniqueItems: true,
  }),
};

/**
 * The steps every caller may express. `fill` clears and inserts the text as one field
 * transaction; `setValue` writes an accessibility value; `press` is a semantic press; `click`
 * acts like the pointer on an element or a capture point (`button` defaults to `left`, `count` to
 * 1; an app refuses a right click, `noBackgroundRoute` with `noRoute`, since Atd never opens a
 * context menu); `key` presses one key with optional modifiers, after focusing `locator`; `type`
 * types text as keystrokes, after focusing `locator`; `clear` empties a field; `menu` invokes a
 * menu-bar item by its titles from the top; `drag` moves from one point to another inside the
 * target's content (a native drag-and-drop session has no background route: where the request
 * allows the foreground the host may complete one inside the window there, and refuses one that
 * leaves the window or needs the real pointer, `noBackgroundRoute` with `dragAndDrop`); `select`
 * chooses the option with this visible label; `scroll` and `wait` only read.
 */
const SHARED_STEPS = [
  Type.Object(
    { kind: Type.Literal('navigate'), url: ComputerUrlSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('fill'), locator: ComputerElementLocatorSchema, text: StepText },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('press'),
      locator: ComputerElementLocatorSchema,
      effect: Type.Union([Type.Literal('click'), Type.Literal('submit')]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('scroll'),
      locator: Type.Optional(ComputerPointLocatorSchema),
      direction: Type.Union([
        Type.Literal('up'),
        Type.Literal('down'),
        Type.Literal('left'),
        Type.Literal('right'),
      ]),
      amount: Type.Integer({ minimum: 1, maximum: 20 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('wait'),
      condition: ComputerConditionSchema,
      timeoutMs: Type.Integer({ minimum: 1, maximum: COMPUTER_WAIT_MAX_MS }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('setValue'), locator: ComputerElementLocatorSchema, text: StepText },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('click'),
      locator: ComputerPointLocatorSchema,
      button: Type.Optional(Type.Union([Type.Literal('left'), Type.Literal('right')])),
      count: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2)])),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('key'),
      key: ComputerKeyNameSchema,
      modifiers: Type.Optional(
        Type.Array(ComputerModifierSchema, { maxItems: 4, uniqueItems: true }),
      ),
      locator: Type.Optional(ComputerElementLocatorSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('type'),
      text: StepText,
      locator: Type.Optional(ComputerPointLocatorSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('clear'), locator: ComputerElementLocatorSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('menu'),
      path: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
        minItems: 1,
        maxItems: 8,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('drag'),
      from: ComputerPointLocatorSchema,
      to: ComputerPointLocatorSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('select'),
      locator: ComputerElementLocatorSchema,
      option: Type.String({ minLength: 1, maxLength: 200 }),
    },
    { additionalProperties: false },
  ),
] as const;

/**
 * One registered step as the host receives it. `upload` sets the task files `resourceIds` names
 * on a file input; `paths` are their absolute files in the service's resource store, in the same
 * order, which only the service fills in after checking each belongs to the run's task. A host
 * refuses an upload without them.
 */
export const ComputerStepSchema = Type.Union([
  ...SHARED_STEPS,
  Type.Object(
    {
      ...uploadFields,
      paths: Type.Optional(
        Type.Array(Type.String({ minLength: 2, maxLength: 4096, pattern: '^/' }), {
          minItems: 1,
          maxItems: COMPUTER_MAX_UPLOAD_FILES,
        }),
      ),
    },
    { additionalProperties: false },
  ),
]);
export type ComputerStep = Static<typeof ComputerStepSchema>;

/**
 * A step as the model supplies it: an `upload` names task resources only and never file paths,
 * so a call carrying `paths` fails validation.
 */
export const ComputerModelStepSchema = Type.Union([
  ...SHARED_STEPS,
  Type.Object(uploadFields, { additionalProperties: false }),
]);
export type ComputerModelStep = Static<typeof ComputerModelStepSchema>;

const actionFields = {
  /** The target the action runs on (`TargetRef.id`), as `targets` listed it. */
  targetRefId: ComputerRefIdSchema,
  /**
   * The surface of that target the steps act on (`SurfaceRef.id`, from the observation); absent
   * acts on the target's root window.
   */
  surfaceRefId: Type.Optional(ComputerRefIdSchema),
  /** The observation its element refs and capture points came from; a stale one fails. */
  observationRefId: ComputerRefIdSchema,
  /** Checked after the last step; its outcome decides `ActionResult.effect` `verified`. */
  postcondition: Type.Optional(ComputerConditionSchema),
  /**
   * The approved recipe step this action carries out. Required in unattended runs, where the
   * service takes the effect from that step rather than from the model.
   */
  recipeStepId: Type.Optional(ComputerStepIdSchema),
};

/**
 * What the model supplies for `act`. It never names a task, grant, host, engine, route, delivery
 * or lease: the service adds the execution envelope and mints `actionId` when it is absent, and
 * the host picks each step's route (`ComputerRoute`) and, where no background route can take it
 * and the envelope allows it, completes it in the foreground (`ComputerDelivery`). `resolves`
 * names earlier unresolved actions of the run this one is meant to settle
 * (`ComputerFact.resolution` `by`); it is service-only and never forwarded to the host.
 */
export const ComputerActionInputSchema = Type.Object(
  {
    actionId: Type.Optional(ComputerActionIdSchema),
    ...actionFields,
    steps: Type.Array(ComputerModelStepSchema, { minItems: 1, maxItems: COMPUTER_MAX_STEPS }),
    resolves: Type.Optional(Type.Array(ComputerActionIdSchema, { minItems: 1, maxItems: 20 })),
  },
  { additionalProperties: false },
);
export type ComputerActionInput = Static<typeof ComputerActionInputSchema>;

/**
 * The action as the host receives it (`HostOperation` `act`): `actionId` always set. The host
 * rejects any step outside the target's engine profile with `unsupported`, before dispatching.
 */
export const ComputerActionSchema = Type.Object(
  {
    actionId: ComputerActionIdSchema,
    ...actionFields,
    steps: Type.Array(ComputerStepSchema, { minItems: 1, maxItems: COMPUTER_MAX_STEPS }),
  },
  { additionalProperties: false },
);
export type ComputerAction = Static<typeof ComputerActionSchema>;

/**
 * The effect a step has. `press` carries its own; a pointer `click`, a `menu` command, a `drag`,
 * an `upload` (the page may send the files anywhere), a key outside plain input
 * (`isPlainKeyInput`) and typed text with a line break may do anything the app binds to them, so
 * they are `invoke`.
 */
export function stepEffect(step: ComputerStep): ComputerEffect {
  switch (step.kind) {
    case 'navigate':
      return 'navigate';
    case 'fill':
    case 'setValue':
    case 'clear':
    case 'select':
      return 'input';
    case 'press':
      return step.effect;
    case 'scroll':
    case 'wait':
      return 'read';
    case 'click':
    case 'menu':
    case 'drag':
    case 'upload':
      return 'invoke';
    case 'key':
      return isPlainKeyInput(step.key, step.modifiers) ? 'input' : 'invoke';
    case 'type':
      return /[\n\r]/.test(step.text) ? 'invoke' : 'input';
  }
}

/** The point locators a step carries (element-only locators can never be image points). */
function pointLocators(step: ComputerStep): readonly ComputerPointLocator[] {
  switch (step.kind) {
    case 'click':
      return [step.locator];
    case 'scroll':
    case 'type':
      return step.locator === undefined ? [] : [step.locator];
    case 'drag':
      return [step.from, step.to];
    case 'navigate':
    case 'fill':
    case 'press':
    case 'wait':
    case 'setValue':
    case 'key':
    case 'clear':
    case 'menu':
    case 'select':
    case 'upload':
      return [];
  }
}

/**
 * Whether a step is visual: any of its locators is a capture point. Visual steps run only for a
 * model qualified for visual operation (`ComputerVisualState` `qualified`).
 */
export function isVisualStep(step: ComputerStep): boolean {
  return pointLocators(step).some(isImagePoint);
}
