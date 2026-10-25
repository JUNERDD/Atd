import { Type, type Static } from 'typebox';
import { ComputerObserveRegionSchema } from './computer-capture.js';
import {
  COMPUTER_TEXT_MAX_LENGTH,
  ComputerRefIdSchema,
  ComputerUrlSchema,
} from './computer-actions.js';

/**
 * What a step points at and what a host can check. Element locators (a ref or a semantic
 * description) name one element of the target's accessibility tree, or, for an app's pointer step,
 * text it shows that no element holds; an image point names a pixel of one capture the model saw
 * and only point-capable steps accept it. Conditions address elements or screen text; native
 * newText can narrow verification to a region of the observed capture.
 */

/** A locator by element ref: valid only for the observation (`observationRefId`) it came from. */
export const ComputerRefLocatorSchema = Type.Object(
  { ref: ComputerRefIdSchema },
  { additionalProperties: false },
);

/**
 * A semantic locator, the only kind a recipe stores: the host resolves it to exactly one element
 * of the current target, or fails the step with `ambiguous` or `notFound`. At least one field. On
 * an application target, a `click` or `drag` locator that names only `text` no element holds is
 * located on that text as the window shows it when the step runs (recognized text, read again so
 * a moved, resized or zoomed window is followed); the host picks the point, so the step is not
 * visual.
 */
export const ComputerSemanticLocatorSchema = Type.Object(
  {
    role: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    placeholder: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    text: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type ComputerSemanticLocator = Static<typeof ComputerSemanticLocatorSchema>;

/**
 * A point in pixels of capture `capture` (`ComputerCapture.id`, sized `width` × `height` as
 * reported), origin top-left. The host maps it through that capture's frame and scale only after
 * rechecking the window identity, geometry and freshness; the model never names a screen point. A
 * step carrying one is visual (`isVisualStep`) and needs a qualified model.
 */
export const ComputerImagePointSchema = Type.Object(
  {
    capture: ComputerRefIdSchema,
    x: Type.Integer({ minimum: 0 }),
    y: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ComputerImagePoint = Static<typeof ComputerImagePointSchema>;

/** One element of the target: by ref or semantic description. */
export const ComputerElementLocatorSchema = Type.Union([
  ComputerRefLocatorSchema,
  ComputerSemanticLocatorSchema,
]);
export type ComputerElementLocator = Static<typeof ComputerElementLocatorSchema>;

/** The element locator under its original name, which conditions, recipes and steps share. */
export const ComputerLocatorSchema = ComputerElementLocatorSchema;
export type ComputerLocator = ComputerElementLocator;

/** Where a pointer-like step acts: an element, or a point of a capture. */
export const ComputerPointLocatorSchema = Type.Union([
  ComputerRefLocatorSchema,
  ComputerSemanticLocatorSchema,
  ComputerImagePointSchema,
]);
export type ComputerPointLocator = Static<typeof ComputerPointLocatorSchema>;

/** Whether a point locator names a pixel of a capture rather than an element. */
export function isImagePoint(locator: ComputerPointLocator): locator is ComputerImagePoint {
  return 'capture' in locator;
}

/** A native application's exact menu titles, starting at its menu bar. */
export const ComputerMenuPathSchema = Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
  minItems: 2,
  maxItems: 8,
});

/**
 * What a host can check, before a step (`wait`), after an action (`postcondition`) or as an
 * automation's completion. `urlMatches` is a page URL prefix; `newText` compares identifiers
 * against the action's baseline, optionally inside `locator` or a native capture `region`, and
 * matching an ICU/ECMAScript pattern. A native submit or invoke takes `newText` only with one of
 * the three, since unscoped it holds on any text that changes in the window. `menuItemAvailable`
 * reads an exact native application menu path without invoking it.
 */
export const ComputerConditionSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal('menuItemAvailable'), path: ComputerMenuPathSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('enabled'), locator: ComputerElementLocatorSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('valueEquals'),
      locator: ComputerElementLocatorSchema,
      text: Type.String({ maxLength: COMPUTER_TEXT_MAX_LENGTH }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('textAppears'), text: Type.String({ minLength: 1, maxLength: 500 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('urlMatches'), pattern: ComputerUrlSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('newText'),
      locator: Type.Optional(ComputerElementLocatorSchema),
      /** Native attended verification inside the action's full observation; never a new capture. */
      region: Type.Optional(ComputerObserveRegionSchema),
      pattern: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    },
    { additionalProperties: false, not: { required: ['locator', 'region'] } },
  ),
]);
export type ComputerCondition = Static<typeof ComputerConditionSchema>;
