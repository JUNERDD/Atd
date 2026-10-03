import { Type } from 'typebox';
import { MemoryTargetSchema, QuoteSourceSchema } from '@atd/agent-contracts';
import { FileRefSchema } from '../../client/agent/task-schema';

const name = Type.String({ maxLength: 1024 });

/** Runtime shape of `Chip`; drafts persisted by an earlier build are checked against it. */
const ChipSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal('file'), file: FileRefSchema, context: Type.Optional(FileRefSchema) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('folder'),
      folderId: name,
      name,
      path: Type.Optional(Type.String({ maxLength: 4096 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('task'), taskId: name, title: name },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('mcpServer'), serverId: name }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('agent'), name }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('skill'), name }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal('command'), commandId: name, name },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('memory'), target: MemoryTargetSchema, entryId: name, title: name },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('quote'), text: Type.String(), source: Type.Optional(QuoteSourceSchema) },
    { additionalProperties: false },
  ),
]);

/** Runtime shape of `ComposerDraft`. The text is not capped: the composer enforces its own limit. */
export const ComposerDraftSchema = Type.Object(
  {
    text: Type.String(),
    chips: Type.Array(
      Type.Object(
        {
          from: Type.Integer({ minimum: 0 }),
          to: Type.Integer({ minimum: 0 }),
          chip: ChipSchema,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
