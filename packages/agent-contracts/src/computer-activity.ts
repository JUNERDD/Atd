import { Type, type Static } from 'typebox';
import { ComputerStepKindSchema } from './computer-actions.js';
import { ComputerDetailsSchema } from './computer-results.js';
import { Identifier } from './identifiers.js';

/** Display identity copied only from a validated host-prepared binding or access candidate. */
export const ComputerActivityTargetSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('native'),
      bindingId: Type.Optional(Identifier),
      label: Type.String({ minLength: 1, maxLength: 120 }),
      appName: Type.String({ minLength: 1, maxLength: 255 }),
      bundleId: Type.String({ minLength: 1, maxLength: 255 }),
      appPath: Type.String({ minLength: 2, maxLength: 4096, pattern: '^/' }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('browser'),
      bindingId: Type.Optional(Identifier),
      label: Type.String({ minLength: 1, maxLength: 120 }),
    },
    { additionalProperties: false },
  ),
]);
export type ComputerActivityTarget = Static<typeof ComputerActivityTargetSchema>;

export const ComputerActivityOperationSchema = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    op: ComputerDetailsSchema.properties.op,
    inFlight: Type.Boolean(),
    stepKind: Type.Optional(ComputerStepKindSchema),
    /** Sanitized operation metadata; never typed text, raw arguments or screen contents. */
    summary: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type ComputerActivityOperation = Static<typeof ComputerActivityOperationSchema>;

export const ComputerActivityProblemSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 128 }),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    message: Type.String({ maxLength: 500 }),
  },
  { additionalProperties: false },
);
export type ComputerActivityProblem = Static<typeof ComputerActivityProblemSchema>;

/**
 * What a task's run did with the computer, for a run that called the computer tool. The task
 * activity row (`TaskActivityRunSchema.computer`) carries it beside the run's own lifecycle.
 */
export const ComputerActivitySchema = Type.Object(
  {
    operation: ComputerActivityOperationSchema,
    target: Type.Optional(ComputerActivityTargetSchema),
    problem: Type.Optional(ComputerActivityProblemSchema),
  },
  { additionalProperties: false },
);
export type ComputerActivity = Static<typeof ComputerActivitySchema>;
