import { Type, type Static } from 'typebox';
import { Identifier, ToolIdSchema } from './command-schema';

export const ToolArgumentsSchema = Type.Object(
  {
    path: Type.Optional(Type.String({ maxLength: 4096 })),
    content: Type.Optional(Type.String({ maxLength: 1000000 })),
    edits: Type.Optional(
      Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() }), {
        maxItems: 100,
      }),
    ),
    command: Type.Optional(Type.String({ maxLength: 100000 })),
    timeout: Type.Optional(Type.Number({ minimum: 0, maximum: 600 })),
    offset: Type.Optional(Type.Number({ minimum: 1 })),
    limit: Type.Optional(Type.Number({ minimum: 1 })),
  },
  { additionalProperties: false },
);
export type ToolArguments = Static<typeof ToolArgumentsSchema>;
export const NativeRequestSchema = Type.Union([
  Type.Object({ action: Type.Literal('modelAuth'), taskId: Identifier, runId: Identifier }),
  Type.Object({
    action: Type.Literal('authorize'),
    taskId: Identifier,
    runId: Identifier,
    toolCallId: Type.String(),
    tool: ToolIdSchema,
    args: ToolArgumentsSchema,
  }),
  Type.Object({ action: Type.Literal('read'), grant: Identifier, path: Type.String() }),
  Type.Object({ action: Type.Literal('access'), grant: Identifier, path: Type.String() }),
  Type.Object({
    action: Type.Literal('write'),
    grant: Identifier,
    path: Type.String(),
    content: Type.String({ maxLength: 1000000 }),
  }),
  Type.Object({ action: Type.Literal('mkdir'), grant: Identifier, path: Type.String() }),
  Type.Object({
    action: Type.Literal('shell'),
    grant: Identifier,
    command: Type.String(),
    cwd: Type.String(),
  }),
  Type.Object({ action: Type.Literal('release'), grant: Identifier }),
]);
export type NativeRequest = Static<typeof NativeRequestSchema>;
