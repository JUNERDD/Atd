/**
 * The review card of a command whose answer waits for review (`commandProgress.show`'s `answer`
 * with `review`, in `text-calls.ts`), and what the card hands back to make another version
 * (`commandProgress.action`'s `adjust`). Loaded by the export script with Node's type stripping,
 * so it imports nothing but TypeBox and its sibling contract files (by their `.ts` names) and uses
 * only erasable TypeScript syntax.
 */
import { Type } from 'typebox';
import { CommandArgumentsSchema, CommandOptionsSchema } from './command-options.ts';
import { MAX_CAPTURE_LENGTH, MAX_NATIVE_TEXT_LENGTH } from './primitives.ts';

/** Versions a review keeps; the page makes no more once it has this many. */
export const MAX_REVIEW_VERSIONS = 20;
/** Adjustment suggestions a command offers (agent-contracts bounds the command's own list). */
export const MAX_REVIEW_ADJUSTMENTS = 8;
const AdjustmentText = Type.String({ minLength: 1, maxLength: 40 });

/**
 * One run of the answer's changes against `source`, in order: text both have (`same`), text the
 * answer adds (`insert`) and text it drops (`delete`).
 */
export const ReviewChangeSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal('same'), Type.Literal('insert'), Type.Literal('delete')]),
    text: Type.String({ minLength: 1, maxLength: MAX_NATIVE_TEXT_LENGTH }),
  },
  { additionalProperties: false },
);

/**
 * What the answer card adds while the answer waits for review (the command's output has
 * `review`): `source`, the text the run read in place of the selection, shown above the answer
 * (absent: it read none); `changes`, the answer marked against `source` when the page judged the
 * answer a rewrite of it (absent: the card shows the answer plain, under `source`); `version` of
 * `count` versions the review has made, the card stepping between them while there are several;
 * `options`, the command's parameters as this version ran with them, which the card changes for
 * the next version (a lone choice as chips of its values, any other set as `summary` opening the
 * options sheet); `adjustments`, the command's suggested adjustments, offered as chips; and
 * `pending`, set while the next version is being made (by Regenerate, an adjustment or changed
 * options), which the card shows as being made and offers to stop (the island's review card on a
 * page of its own after the `count` kept ones, `version` being `count` + 1 there: `text-calls.ts`).
 */
export const CommandReviewSchema = Type.Object(
  {
    source: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_CAPTURE_LENGTH })),
    changes: Type.Optional(Type.Array(ReviewChangeSchema, { minItems: 1, maxItems: 4000 })),
    version: Type.Integer({ minimum: 1, maximum: MAX_REVIEW_VERSIONS }),
    count: Type.Integer({ minimum: 1, maximum: MAX_REVIEW_VERSIONS }),
    options: CommandOptionsSchema,
    summary: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    adjustments: Type.Array(AdjustmentText, { maxItems: MAX_REVIEW_ADJUSTMENTS }),
    pending: Type.Optional(
      Type.Union([Type.Literal('regenerate'), Type.Literal('adjust'), Type.Literal('options')]),
    ),
  },
  { additionalProperties: false },
);

/**
 * The next version the review card asks for (`commandProgress.action`'s `adjust`), everything the
 * card had staged at once: `text`, what was typed (empty for none); `adjustments`, the chosen
 * suggestions in the order chosen; `arguments`, every option value the next run uses when the
 * person changed any (absent: the version's own). At least one of them asks for a change.
 */
export const ReviewAdjustSchema = Type.Object(
  {
    text: Type.String({ maxLength: 2000 }),
    adjustments: Type.Array(AdjustmentText, { maxItems: MAX_REVIEW_ADJUSTMENTS }),
    arguments: Type.Optional(CommandArgumentsSchema),
  },
  { additionalProperties: false },
);
