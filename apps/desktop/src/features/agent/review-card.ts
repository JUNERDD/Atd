import type { Static } from 'typebox';
import { commandOptions, valuesSummary } from '../../client/agent/command-arguments';
import type { ArgumentValues, CommandDefinition } from '../../client/agent/command-schema';
import type { CommandReviewSchema } from '../../native-bridge/command-review';
import type { Review } from './review-model';

/**
 * What a review card shows of a review besides the answer: the same state for the island's
 * review card and for the result card beside a screenshot (`CommandReviewSchema`).
 */
export type ReviewCard = Static<typeof CommandReviewSchema>;
/** What the next version is being made by, while the card waits for it. */
export type ReviewPendingKind = NonNullable<ReviewCard['pending']>;

/**
 * The card's state for a version with option `values`, number `version` of `count`: the
 * command's options with those values, which the card changes for the next version, its
 * adjustments, and what is pending.
 */
export function reviewCard(
  command: CommandDefinition,
  values: ArgumentValues,
  version: number,
  count: number,
  pending?: ReviewPendingKind,
): ReviewCard {
  const summary = valuesSummary(command, values);
  return {
    version,
    count,
    options: commandOptions(command, values),
    ...(summary ? { summary } : {}),
    adjustments: command.adjustments ?? [],
    ...(pending ? { pending } : {}),
  };
}

/** The card's state for the kept version `review` shows, or null when it has none. */
export function shownCard(command: CommandDefinition, review: Review): ReviewCard | null {
  const shown = review.versions[review.shown];
  if (!shown) return null;
  const { length } = review.versions;
  return reviewCard(command, shown.values, review.shown + 1, length, review.pending?.kind);
}

/**
 * The card's state for the pending version's page, after the kept ones (`version` is their count
 * plus one): the values it is made with, and what is making it; null while none is pending.
 */
export function pendingCard(command: CommandDefinition, review: Review): ReviewCard | null {
  const { pending } = review;
  if (!pending) return null;
  const { length } = review.versions;
  return reviewCard(command, pending.plan.values, length + 1, length, pending.kind);
}
