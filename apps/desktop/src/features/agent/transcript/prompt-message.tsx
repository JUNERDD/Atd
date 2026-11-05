import { Fragment } from 'react';
import type { RunSnapshot } from '../../../client/agent/task-schema';
import { ChipToken } from '../../composer-editor/chip-content';
import { revealQuote } from './selection-toolbar/quote-reveal';
import { MessageBubble } from './message-bubble';
import { composedPrompt, sentChipName, type SentSegment } from './composed-prompt';

/** Shows the passage a quote chip was taken from, when it records where. */
function revealerOf(segment: Exclude<SentSegment, string>) {
  if (segment.kind !== 'quote' || !segment.source) return undefined;
  const source = segment.source;
  return () => revealQuote(source);
}

/** Text runs and chips in document order; the bubble's `pre-wrap` keeps the text's own breaks. */
function SentText({ segments }: { segments: readonly SentSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        typeof segment === 'string' ? (
          <Fragment key={index}>{segment}</Fragment>
        ) : (
          <ChipToken
            key={index}
            {...(segment.kind === 'application'
              ? { kind: segment.kind, bundleId: segment.bundleId, name: segment.name }
              : { kind: segment.kind, name: sentChipName(segment) })}
            onReveal={revealerOf(segment)}
          />
        ),
      )}
    </>
  );
}

/**
 * A run's prompt bubble as composed, chips drawn as in the composer. `fallback` is the plain text
 * shown when the run did not prompt with its composed text (see `composedPrompt`). Attachments
 * belong to `UserMessage`, which keeps them mounted when this bubble is replaced by the editor.
 */
export function PromptMessage({ snapshot, fallback }: { snapshot: RunSnapshot; fallback: string }) {
  const composed = composedPrompt(snapshot);
  return <MessageBubble>{composed ? <SentText segments={composed} /> : fallback}</MessageBubble>;
}
