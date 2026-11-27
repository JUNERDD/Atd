import { Type, type Static } from 'typebox';
import { CHROME_CHANNEL_PROTOCOL, IdSchema, TabIdSchema, TargetIdSchema } from './payloads.ts';

/**
 * K2 diagnostics schemas (`diag.batch`), mirrored by hand in `AIChromeChannelKit`
 * (`ChromeInboundDiagnostics.swift`). Keep field names and bounds byte-for-byte identical;
 * never name a field `sessionId` or `session_id` (use `cdpSession`).
 */

export const DIAG_BATCH_MAX_ENTRIES = 32;
export const DIAG_DROPPED_MAX = 1_000_000;
export const DIAG_SEQ_MAX = 2_147_483_647;
export const DIAG_TS_MAX = 64;
export const DIAG_CAT_MAX = 64;
export const DIAG_MSG_MAX = 256;
export const DIAG_CODE_MAX = 64;
export const DIAG_CDP_SESSION_MAX = 128;
export const DIAG_ORIGIN_MAX = 256;

export const DiagSurfaceSchema = Type.Union([
  Type.Literal('background'),
  Type.Literal('content'),
  Type.Literal('panel'),
  Type.Literal('options'),
]);
export type DiagSurface = Static<typeof DiagSurfaceSchema>;

export const DiagLevelSchema = Type.Union([
  Type.Literal('info'),
  Type.Literal('warn'),
  Type.Literal('error'),
]);
export type DiagLevel = Static<typeof DiagLevelSchema>;

export const DiagEntrySchema = Type.Object({
  seq: Type.Integer({ minimum: 1, maximum: DIAG_SEQ_MAX }),
  /** UTC ISO-8601 timestamp (`new Date().toISOString()`). */
  extTs: Type.String({ minLength: 1, maxLength: DIAG_TS_MAX }),
  surface: DiagSurfaceSchema,
  level: DiagLevelSchema,
  cat: Type.String({ minLength: 1, maxLength: DIAG_CAT_MAX }),
  /** Single-line pre-sanitized summary (newlines collapsed). */
  msg: Type.String({ minLength: 1, maxLength: DIAG_MSG_MAX }),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: DIAG_CODE_MAX })),
  runId: Type.Optional(IdSchema),
  tabId: Type.Optional(TabIdSchema),
  targetId: Type.Optional(TargetIdSchema),
  cdpSession: Type.Optional(Type.String({ minLength: 1, maxLength: DIAG_CDP_SESSION_MAX })),
  /** `http(s)` origin clipped to 256, or scheme-only (`chrome:`, `file:`, …) for non-http(s). */
  origin: Type.Optional(Type.String({ minLength: 1, maxLength: DIAG_ORIGIN_MAX })),
});
export type DiagEntry = Static<typeof DiagEntrySchema>;

export const DiagBatchFrameSchema = Type.Object({
  v: Type.Literal(CHROME_CHANNEL_PROTOCOL),
  t: Type.Literal('diag.batch'),
  dropped: Type.Optional(Type.Integer({ minimum: 0, maximum: DIAG_DROPPED_MAX })),
  entries: Type.Array(DiagEntrySchema, { minItems: 1, maxItems: DIAG_BATCH_MAX_ENTRIES }),
});
export type DiagBatchFrame = Static<typeof DiagBatchFrameSchema>;
