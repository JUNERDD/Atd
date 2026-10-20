import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { ComputerRefIdSchema } from './computer-actions.js';

/** A run can monitor four independent, explicitly authorized sources at once. */
export const COMPUTER_MAX_VISUAL_SOURCES = 4;
export const ScreenCursorSchema = Type.Object(
  { sourceId: Identifier, sequence: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
export type ScreenCursor = Static<typeof ScreenCursorSchema>;

/** Each start adds a system-picker selection; stopping without an id ends all selections. */
export const ScreenShareOperationSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal('screenShare'), mode: Type.Literal('start') },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('screenShare'),
      mode: Type.Literal('read'),
      after: Type.Optional(
        Type.Array(ScreenCursorSchema, { maxItems: COMPUTER_MAX_VISUAL_SOURCES }),
      ),
      timeoutMs: Type.Integer({ minimum: 0, maximum: 30_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('screenShare'),
      mode: Type.Literal('stop'),
      sourceId: Type.Optional(Identifier),
    },
    { additionalProperties: false },
  ),
]);
export type ScreenShareOperation = Static<typeof ScreenShareOperationSchema>;

const source = {
  sourceId: Identifier,
  label: Type.String({ minLength: 1, maxLength: 120 }),
  sequence: Type.Integer({ minimum: 0 }),
  checkedAt: Type.String(),
};

/** Raw stream revisions never mint actionable observations. Unavailable means no current image. */
export const VisualSourceSchema = Type.Union([
  Type.Object(
    {
      ...source,
      state: Type.Literal('frame'),
      capturedAt: Type.String(),
      width: Type.Integer({ minimum: 1, maximum: 1280 }),
      height: Type.Integer({ minimum: 1, maximum: 1280 }),
      mime: Type.Literal('image/jpeg'),
      base64: Type.String({ minLength: 1, maxLength: 1_398_104 }),
    },
    { additionalProperties: false },
  ),
  Type.Object({ ...source, state: Type.Literal('unchanged') }, { additionalProperties: false }),
  Type.Object(
    {
      ...source,
      state: Type.Literal('unavailable'),
      reason: Type.Union([
        Type.Literal('starting'),
        Type.Literal('blank'),
        Type.Literal('suspended'),
        Type.Literal('captureFailed'),
        Type.Literal('locked'),
        Type.Literal('targetUnavailable'),
        Type.Literal('permission'),
        Type.Literal('disconnected'),
      ]),
    },
    { additionalProperties: false },
  ),
]);
export type VisualSource = Static<typeof VisualSourceSchema>;
export type ScreenShareFrame = Extract<VisualSource, { state: 'frame' }>;

export const ScreenShareReplySchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('screenShare'),
      state: Type.Literal('sharing'),
      sources: Type.Array(VisualSourceSchema, {
        minItems: 1,
        maxItems: COMPUTER_MAX_VISUAL_SOURCES,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('screenShare'),
      state: Type.Literal('ended'),
      reason: Type.Union([
        Type.Literal('notStarted'),
        Type.Literal('cancelled'),
        Type.Literal('stopped'),
        Type.Literal('finished'),
        Type.Literal('disconnected'),
        Type.Literal('captureFailed'),
      ]),
    },
    { additionalProperties: false },
  ),
]);
export type ScreenShareReply = Static<typeof ScreenShareReplySchema>;

/** Inference-boundary read: only observed targets of this run and its system-selected shares. */
export const ScreenContextOperationSchema = Type.Object(
  {
    kind: Type.Literal('screenContext'),
    targetRefIds: Type.Array(ComputerRefIdSchema, {
      maxItems: COMPUTER_MAX_VISUAL_SOURCES,
      uniqueItems: true,
    }),
    includeShared: Type.Boolean(),
    limit: Type.Integer({ minimum: 1, maximum: COMPUTER_MAX_VISUAL_SOURCES }),
  },
  { additionalProperties: false },
);
export const ScreenContextReplySchema = Type.Object(
  {
    kind: Type.Literal('screenContext'),
    sharedSources: Type.Array(ScreenCursorSchema, { maxItems: COMPUTER_MAX_VISUAL_SOURCES }),
    sources: Type.Array(VisualSourceSchema, { maxItems: COMPUTER_MAX_VISUAL_SOURCES }),
  },
  { additionalProperties: false },
);
export type ScreenContextReply = Static<typeof ScreenContextReplySchema>;
