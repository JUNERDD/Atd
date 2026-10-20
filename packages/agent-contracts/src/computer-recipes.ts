import { Type, type Static } from 'typebox';
import {
  COMPUTER_TEXT_MAX_LENGTH,
  COMPUTER_WAIT_MAX_MS,
  ComputerStepIdSchema,
  ComputerUrlSchema,
  type ComputerEffect,
} from './computer-actions.js';
import { ComputerConditionSchema, ComputerSemanticLocatorSchema } from './computer-locators.js';
import { COMPUTER_MAX_RUN_BINDINGS } from './computer-targets.js';
import { Identifier } from './identifiers.js';

/**
 * Recipes: the versioned step table an automation embeds in its definition
 * (`AutomationPolicy.computer`), which unattended runs may carry out and nothing else. A recipe has
 * no element refs (each run resolves its semantic locators again) and lives only inside its
 * automation, never in a shared library someone could edit separately. The service hashes it
 * (`recipeHash` over `canonicalJson`), and any change to a step, branch or condition changes the
 * hash and so invalidates the grant.
 */

export const COMPUTER_MAX_RECIPE_STEPS = 32;
/** The most submits one unattended run may perform (recipes never carry `invoke`). */
export const COMPUTER_MAX_SUBMITS = 5;

/** Bounds on the text an unattended `fill` or `setValue` may insert; the model picks the text. */
export const ComputerTextConstraintSchema = Type.Object(
  {
    maxLength: Type.Integer({ minimum: 1, maximum: COMPUTER_TEXT_MAX_LENGTH }),
    /** A regular expression (the ICU/ECMAScript common subset) the whole text must match. */
    pattern: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    /** When set, the text must equal one of these. */
    oneOf: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 20 }),
    ),
  },
  { additionalProperties: false },
);
export type ComputerTextConstraint = Static<typeof ComputerTextConstraintSchema>;

const stepFields = {
  stepId: ComputerStepIdSchema,
  /** The binding the step acts on; one of the policy's `bindingIds`. */
  bindingId: Identifier,
  /** What the person reads for this step in the editor and the authorization dialog. */
  label: Type.String({ minLength: 1, maxLength: 200 }),
  /** Must hold before the step runs, else the run stops before dispatching it. */
  precondition: Type.Optional(ComputerConditionSchema),
  /** Must hold after the step; failing it leaves the step's effect `partial` or `unknown`. */
  postcondition: Type.Optional(ComputerConditionSchema),
  /**
   * The steps that may follow this one (its allowed branches); empty ends the recipe. The recipe
   * starts at its first step.
   */
  next: Type.Array(ComputerStepIdSchema, { maxItems: 8, uniqueItems: true }),
};

/**
 * One approved step, by the step kind it allows (`ComputerStepSchema`). Its effect is pinned by the
 * kind and, for `press`, by `effect`: an unattended action takes its effect from here, never from
 * the model, and its parameters must satisfy the step's constraints.
 */
export const ComputerRecipeStepSchema = Type.Union([
  Type.Object(
    {
      ...stepFields,
      kind: Type.Literal('navigate'),
      /** The navigated URL must start with this prefix, inside the binding's origins. */
      urlPrefix: ComputerUrlSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...stepFields,
      kind: Type.Literal('fill'),
      locator: ComputerSemanticLocatorSchema,
      text: ComputerTextConstraintSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...stepFields,
      kind: Type.Literal('press'),
      locator: ComputerSemanticLocatorSchema,
      effect: Type.Union([Type.Literal('click'), Type.Literal('submit')]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...stepFields,
      kind: Type.Literal('scroll'),
      locator: Type.Optional(ComputerSemanticLocatorSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...stepFields,
      kind: Type.Literal('wait'),
      condition: ComputerConditionSchema,
      timeoutMs: Type.Integer({ minimum: 1, maximum: COMPUTER_WAIT_MAX_MS }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...stepFields,
      kind: Type.Literal('setValue'),
      locator: ComputerSemanticLocatorSchema,
      text: ComputerTextConstraintSchema,
    },
    { additionalProperties: false },
  ),
]);
export type ComputerRecipeStep = Static<typeof ComputerRecipeStepSchema>;

/**
 * A recipe. `version` is the recipe format; step ids are unique and every `next` names a step of
 * the same recipe (the service checks both when saving).
 */
export const ComputerRecipeSchema = Type.Object(
  {
    version: Type.Literal(1),
    steps: Type.Array(ComputerRecipeStepSchema, {
      minItems: 1,
      maxItems: COMPUTER_MAX_RECIPE_STEPS,
    }),
  },
  { additionalProperties: false },
);
export type ComputerRecipe = Static<typeof ComputerRecipeSchema>;

/**
 * The computer scope an automation requests (`AutomationPolicy.computer`, part of its draft): the
 * bindings, the recipe, the submit budget and the completion condition that alone makes a run
 * `delivered`. Requesting is not authorizing: runs need a valid `Automation.computerGrant`, which
 * only the service writes after a person approves this exact content.
 */
export const AutomationComputerPolicySchema = Type.Object(
  {
    bindingIds: Type.Array(Identifier, {
      minItems: 1,
      maxItems: COMPUTER_MAX_RUN_BINDINGS,
      uniqueItems: true,
    }),
    recipe: ComputerRecipeSchema,
    maxSubmits: Type.Integer({ minimum: 1, maximum: COMPUTER_MAX_SUBMITS }),
    completion: ComputerConditionSchema,
    /** Unattended computer work never brings a window forward or takes the shared input. */
    backgroundOnly: Type.Literal(true),
  },
  { additionalProperties: false },
);
export type AutomationComputerPolicy = Static<typeof AutomationComputerPolicySchema>;

/** The effect a recipe step pins, by its kind; `press` carries its own. */
export function recipeStepEffect(step: ComputerRecipeStep): ComputerEffect {
  switch (step.kind) {
    case 'navigate':
      return 'navigate';
    case 'fill':
    case 'setValue':
      return 'input';
    case 'press':
      return step.effect;
    case 'scroll':
    case 'wait':
      return 'read';
  }
}
