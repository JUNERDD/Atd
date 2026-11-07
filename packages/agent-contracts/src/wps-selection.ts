import { Type, type Static } from 'typebox';

/** Optional WPS spreadsheet integration; document-table selection keeps the native path. */
export const WPS_SELECTION_ADDON = 'wps-selection';

/** No cell text, formula, cell address or clipboard data crosses this boundary. */
export const WpsSelectionEventSchema = Type.Object(
  {
    instance: Type.String({ minLength: 1, maxLength: 80, pattern: '^[a-zA-Z0-9-]+$' }),
    sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    occurredAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    kind: Type.Union([Type.Literal('cells'), Type.Literal('clear'), Type.Literal('context')]),
    /** Compared with the native foreground window; never logged or persisted. */
    windowTitle: Type.String({ maxLength: 512 }),
    hasContent: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type WpsSelectionEvent = Static<typeof WpsSelectionEventSchema>;

/** The shell reads once per selection check. Only the latest event is retained in memory. */
export const WpsSelectionStateSchema = Type.Object(
  {
    installed: Type.Boolean(),
    connected: Type.Boolean(),
    /** The add-in answered this check; cached context alone never proves a selection. */
    sampled: Type.Boolean(),
    requestId: Type.Union([Type.String({ pattern: '^[a-f0-9]{24}$' }), Type.Null()]),
    /** A setup error, suitable for the integration's settings row. */
    error: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    event: Type.Union([WpsSelectionEventSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type WpsSelectionState = Static<typeof WpsSelectionStateSchema>;

export const WpsSelectionStatusSchema = Type.Omit(WpsSelectionStateSchema, [
  'event',
  'sampled',
  'requestId',
]);
export type WpsSelectionStatus = Static<typeof WpsSelectionStatusSchema>;
