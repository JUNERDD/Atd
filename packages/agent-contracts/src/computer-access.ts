import { Type, type Static } from 'typebox';
import { ComputerUrlSchema } from './computer-actions.js';
import { TargetBindingContentSchema, TargetBindingSchema } from './computer-targets.js';

/** An attended request for a specific installed application or website, never arbitrary paths. */
export const ComputerAccessTargetSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('application'),
      application: Type.String({ minLength: 1, maxLength: 255 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('website'), url: ComputerUrlSchema },
    { additionalProperties: false },
  ),
]);
export type ComputerAccessTarget = Static<typeof ComputerAccessTargetSchema>;

/**
 * Approval is scoped to the identity the host resolved and how long it lasts. Access is always
 * background access (`ComputerDelivery`), so the scope carries no delivery of its own.
 */
export const ComputerAccessScopeSchema = Type.Object(
  {
    tool: Type.Literal('computerAccess'),
    target: TargetBindingContentSchema,
    persistence: Type.Union([Type.Literal('run'), Type.Literal('saved')]),
  },
  { additionalProperties: false },
);

/** Resolution reads installation metadata only; opening is sent only after the service gate. */
export const PrepareComputerAccessSchema = Type.Object(
  {
    kind: Type.Literal('prepareAccess'),
    target: ComputerAccessTargetSchema,
  },
  { additionalProperties: false },
);

/**
 * Opens an approved target without bringing anything forward: a running app or browser is left
 * where it is, and a page opens in a background tab. `persistent` keeps the browser profile the
 * binding names after the run.
 */
export const OpenComputerAccessSchema = Type.Object(
  {
    kind: Type.Literal('openAccess'),
    binding: TargetBindingSchema,
    persistent: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const ComputerAccessCandidateSchema = Type.Object(
  {
    kind: Type.Literal('accessCandidate'),
    content: TargetBindingContentSchema,
  },
  { additionalProperties: false },
);

/**
 * The target is open. `activated` says whether opening it made any app active anyway (a browser
 * that had to start may take the front), so what the person is told stays true.
 */
export const ComputerAccessOpenedSchema = Type.Object(
  {
    kind: Type.Literal('accessOpened'),
    activated: Type.Boolean(),
  },
  { additionalProperties: false },
);
