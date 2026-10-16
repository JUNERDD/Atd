import { ScrollArea } from '@atd/ui/components/scroll-area';
import { Skeleton } from '@atd/ui/components/skeleton';
import {
  LoadingPlaceholder,
  TextPlaceholder,
  type LineWidth,
} from '../../../components/loading-placeholder';
import './transcript-placeholder.css';

/** One line of an answer: a `TextPlaceholder` in the 24px line box of transcript prose. */
function AnswerLine({ width }: { width: LineWidth }) {
  return (
    <div className="py-0.5">
      <TextPlaceholder width={width} />
    </div>
  );
}

/**
 * One turn as `TurnView` lays a settled one out: the user's bubble at the trailing edge, the space
 * its hover actions keep, the turn header's check and label over its hairline, the answer's
 * lines, and the action row (shown on the last turn, kept as space on an earlier one).
 */
function TurnPlaceholder({
  bubble,
  answer,
  actions,
}: {
  bubble: 'short' | 'long';
  answer: readonly LineWidth[];
  actions: 'shown' | 'hidden' | 'none';
}) {
  return (
    <div className="transcript-placeholder-turn">
      <div className="transcript-placeholder-prompt" data-actions={actions !== 'none' || undefined}>
        <Skeleton className="transcript-placeholder-bubble" data-size={bubble} />
      </div>
      <div className="turn-header">
        <Skeleton className="size-3.5 shrink-0 rounded-full" />
        <span className="turn-header-label">
          <TextPlaceholder width="twoFifths" />
        </span>
      </div>
      <div>
        {answer.map((width, index) => (
          <AnswerLine key={index} width={width} />
        ))}
      </div>
      {actions !== 'none' && (
        <div className="transcript-placeholder-actions">
          {actions === 'shown' && (
            <>
              <Skeleton className="size-4 rounded-md" />
              <Skeleton className="size-4 rounded-md" />
              <Skeleton className="size-4 rounded-md" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A conversation's turns while its transcript loads, for the inside of `.conversation-messages`:
 * an earlier turn and the last one, each a prompt bubble over a short answer. Like the turns it
 * stands in for, it rests at the bottom of a short column, above the composer. `actions` is false
 * in a subagent's view, whose turns carry no message or turn actions.
 */
export function TranscriptPlaceholder({
  label,
  actions = true,
}: {
  label: string;
  actions?: boolean;
}) {
  return (
    <LoadingPlaceholder label={label} className="gap-5">
      <TurnPlaceholder
        bubble="short"
        answer={['full', 'fourFifths']}
        actions={actions ? 'hidden' : 'none'}
      />
      <TurnPlaceholder
        bubble="long"
        answer={['full', 'full', 'twoThirds']}
        actions={actions ? 'shown' : 'none'}
      />
    </LoadingPlaceholder>
  );
}

/**
 * A conversation that has not loaded yet, in the frame `Transcript` uses (`.conversation`, its
 * scroll area and messages column), so its turns replace the placeholder's in place.
 */
export function ConversationPlaceholder({ label }: { label: string }) {
  return (
    <div className="conversation">
      <ScrollArea
        className="min-h-0 flex-1"
        viewportClassName="overlay-footer-fade"
        gutter="none"
        scrollShadow
      >
        <div className="conversation-messages">
          <TranscriptPlaceholder label={label} />
        </div>
      </ScrollArea>
    </div>
  );
}
