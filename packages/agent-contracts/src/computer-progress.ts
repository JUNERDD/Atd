import { Type, type Static } from 'typebox';
import {
  ComputerActionIdSchema,
  ComputerRefIdSchema,
  ComputerStepKindSchema,
} from './computer-actions.js';
import { ComputerRectSchema } from './computer-capture.js';
import { Identifier } from './identifiers.js';

/**
 * Live progress of the action a host is carrying out (`computer.progress` frames), for the live
 * pointer and the activity row. It is display state, never an input command: the host generates
 * it from its own observation, the model never supplies geometry, and the service keeps only the
 * latest per run instead of persisting each frame. Out-of-order frames, frames of an older host
 * generation and frames past `validUntil` are never drawn (`isNewerProgress`).
 */

const SizeSchema = Type.Object(
  { width: Type.Number({ minimum: 0 }), height: Type.Number({ minimum: 0 }) },
  { additionalProperties: false },
);

/**
 * Where the step acts. `screen`: global display points on display `displayId`; `viewport`: CSS
 * pixels of page `pageId`, whose viewport is `viewport`; `image`: pixels of one screenshot
 * (`resourceId` once saved) of size `size`, which may only be projected onto that same image;
 * `unavailable`: the host knows no position.
 */
export const ComputerGeometrySchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('screen'),
      displayId: Type.Integer({ minimum: 0 }),
      rect: ComputerRectSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('viewport'),
      pageId: ComputerRefIdSchema,
      rect: ComputerRectSchema,
      viewport: SizeSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('image'),
      resourceId: Type.Optional(Identifier),
      rect: ComputerRectSchema,
      size: SizeSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('unavailable') }, { additionalProperties: false }),
]);
export type ComputerGeometry = Static<typeof ComputerGeometrySchema>;

export const ComputerProgressPhaseSchema = Type.Union([
  Type.Literal('locating'),
  Type.Literal('dispatching'),
  Type.Literal('waiting'),
  Type.Literal('verifying'),
  Type.Literal('done'),
  Type.Literal('failed'),
  Type.Literal('cleared'),
]);
export type ComputerProgressPhase = Static<typeof ComputerProgressPhaseSchema>;

/**
 * One progress frame. `seq` increases per host generation; `label` is the kind of the step in
 * progress; `cleared` withdraws whatever the previous frame showed.
 */
export const ComputerProgressSchema = Type.Object(
  {
    taskId: Identifier,
    runId: Identifier,
    operationId: Type.String({ minLength: 1, maxLength: 128 }),
    actionId: ComputerActionIdSchema,
    hostGeneration: Type.Integer({ minimum: 1 }),
    seq: Type.Integer({ minimum: 0 }),
    phase: ComputerProgressPhaseSchema,
    observationRefId: Type.Optional(ComputerRefIdSchema),
    validUntil: Type.String(),
    label: Type.Optional(ComputerStepKindSchema),
    geometry: ComputerGeometrySchema,
  },
  { additionalProperties: false },
);
export type ComputerProgress = Static<typeof ComputerProgressSchema>;

/**
 * Whether `next` supersedes `current` for the same run: a newer host generation, or a higher
 * `seq` within the same generation. A frame that does not supersede is dropped, not drawn.
 */
export function isNewerProgress(
  current: Pick<ComputerProgress, 'hostGeneration' | 'seq'> | undefined,
  next: Pick<ComputerProgress, 'hostGeneration' | 'seq'>,
): boolean {
  if (current === undefined) return true;
  if (next.hostGeneration !== current.hostGeneration) {
    return next.hostGeneration > current.hostGeneration;
  }
  return next.seq > current.seq;
}
