import { Type, type Static } from 'typebox';
import { ApplicationReferenceSchema } from './application-reference.js';
import { Identifier } from './identifiers.js';
import { McpServerIdSchema } from './mcp.js';
import { MemoryTargetSchema } from './memory.js';
import { MAX_QUOTE_CHARS, QuoteSourceSchema } from './quotes.js';
import { SkillName } from './skills.js';
import { SubagentNameSchema } from './subagents.js';

/** Upper bound on the chip records one submitted message carries. */
export const MAX_INPUT_CHIPS = 64;

/**
 * Display record of one composer chip, kept with the submitted text so the transcript and the
 * title show the message the way it was composed. Each kind holds only what the chip shows and
 * identifies; what the run does with it still comes from staging (skills, references), `files`
 * and `folders`.
 * A quote is the exception: it identifies nothing outside the message, so its record carries the
 * quoted Markdown itself, which the run reads into its material and a resend restores.
 */
export const InputChipSchema = Type.Union([
  ApplicationReferenceSchema,
  Type.Object(
    { kind: Type.Literal('file'), fileId: Identifier, name: Type.String({ maxLength: 255 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('folder'),
      folderId: Identifier,
      /** The folder's basename when it was added; the record keeps no path. */
      name: Type.String({ minLength: 1, maxLength: 255 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('task'), taskId: Identifier, title: Type.String({ maxLength: 1024 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('mcpServer'), serverId: McpServerIdSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('agent'), name: SubagentNameSchema },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('skill'), name: SkillName }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal('command'),
      commandId: Identifier,
      /** The command's name when it was picked; a plugin command's is `<plugin>:<item>`. */
      name: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('memory'),
      target: MemoryTargetSchema,
      entryId: Identifier,
      /** One line of the entry's content, shown in place of the whole entry. */
      title: Type.String({ minLength: 1, maxLength: 1024 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('quote'),
      text: Type.String({ minLength: 1, maxLength: MAX_QUOTE_CHARS }),
      /** Absent when the passage cannot be found again (a subagent's answer, an older client). */
      source: Type.Optional(QuoteSourceSchema),
    },
    { additionalProperties: false },
  ),
]);
export type InputChip = Static<typeof InputChipSchema>;

/**
 * A chip and the `[from, to)` UTF-16 range of its serialized token in `TaskInput.text`. The
 * schema bounds the numbers only; acceptance checks that ranges lie inside the text, ascending and
 * without overlap.
 */
export const InputChipRangeSchema = Type.Object(
  {
    from: Type.Integer({ minimum: 0, maximum: 100000 }),
    to: Type.Integer({ minimum: 0, maximum: 100000 }),
    chip: InputChipSchema,
  },
  { additionalProperties: false },
);
export type InputChipRange = Static<typeof InputChipRangeSchema>;
