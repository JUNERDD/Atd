import { Fragment } from 'react';
import type { RunSnapshot } from '../../../client/agent/task-schema';
import { ChipToken } from '../../composer-editor/chip-content';
import { UserContext } from '../user-context';
import { MessageBubble } from './message-bubble';
import { chipFileIds, composedPrompt, sentChipName, type SentSegment } from './composed-prompt';

/** Text runs and chips in document order; the bubble's `pre-wrap` keeps the text's own breaks. */
function SentText({ segments }: { segments: readonly SentSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        typeof segment === 'string' ? (
          <Fragment key={index}>{segment}</Fragment>
        ) : (
          <ChipToken key={index} kind={segment.kind} name={sentChipName(segment)} />
        ),
      )}
    </>
  );
}

/**
 * A run's prompt: the context captured with the run above the bubble, and the message the way it
 * was composed, chips drawn as in the composer. `fallback` is the plain text shown when the run did
 * not prompt with its composed text (see `composedPrompt`).
 */
export function PromptMessage({ snapshot, fallback }: { snapshot: RunSnapshot; fallback: string }) {
  const composed = composedPrompt(snapshot);
  return (
    <>
      <UserContext snapshot={snapshot} chipFileIds={chipFileIds(composed)} />
      <MessageBubble>{composed ? <SentText segments={composed} /> : fallback}</MessageBubble>
    </>
  );
}
