import { Type } from 'typebox';

const Id = Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' });

/** Only the host registers authorized sources; video pixels never cross the WebView bridge. */
export const ComputerPreviewSourceSchema = Type.Object(
  {
    sourceId: Id,
    taskId: Id,
    runId: Id,
    label: Type.String({ minLength: 1, maxLength: 120 }),
    kind: Type.Union([Type.Literal('native'), Type.Literal('browser')]),
  },
  { additionalProperties: false },
);

/** The native monitor owns its display subscriptions independently of the chat document. */
export const NativeComputerPreviewCalls = {
  'computer.preview.show': {
    params: Type.Object({ taskId: Id }, { additionalProperties: false }),
    result: Type.Object({ shown: Type.Boolean() }, { additionalProperties: false }),
  },
};
