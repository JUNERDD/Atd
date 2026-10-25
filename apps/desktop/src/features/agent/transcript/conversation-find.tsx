import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import { useCompositionQuery } from '@atd/ui/lib/ime';
import { FindBar } from './find/find-bar';
import { FindRuler } from './find/find-ruler';
import { useFindSession } from './find/use-find-session';
import { useFindShortcut } from './find/use-find-shortcut';
import './find/conversation-find.css';

/**
 * Find in the conversation (S4): a capsule find bar under the header and the matches' marks along
 * the transcript's trailing edge. The props are the transcript's side of the contract.
 */
export interface ConversationFindProps {
  /** Whether the find bar is shown; the transcript owns this state. */
  open: boolean;
  /** Bumped by every open request, including one while open: focus the field, select its query. */
  focusRequest: number;
  /** Requests opening (⌘F, which this component binds while not `covered`). */
  onOpen: () => void;
  /** Closes the bar; the component clears its marks first. */
  onClose: () => void;
  /** The transcript's scroll viewport. */
  viewportRef: RefObject<HTMLDivElement | null>;
  /** The element holding the rendered turns, which the search walks. */
  root: HTMLElement | null;
  /** How many turns the conversation has, mounted or not. */
  turnCount: number;
  /** Extends the transcript's window of mounted turns so it starts at `index`. */
  include: (index: number) => void;
  /** A drill-in or side chat covers the conversation: keys stay unbound and nothing shows. */
  covered: boolean;
}

type FindQuery = ReturnType<typeof useCompositionQuery>;

/**
 * Binds ⌘F while the conversation is not covered and shows the open find. The query outlives the
 * bar, so opening it again selects the last one; the matches, their highlights and marks live only
 * while it shows.
 */
export function ConversationFind(props: ConversationFindProps): ReactElement | null {
  const query = useCompositionQuery();
  useFindShortcut(!props.covered, props.onOpen);
  if (!props.open || props.covered) return null;
  return <FindSession {...props} query={query} />;
}

/**
 * The open find. Each focus request focuses the field with its text selected and searches again;
 * the first records where focus was, which closing returns it to while it can take it.
 */
function FindSession({
  focusRequest,
  onClose,
  viewportRef,
  root,
  turnCount,
  include,
  query: { text, query, change, compositionProps },
}: ConversationFindProps & { query: FindQuery }) {
  const barRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const requested = useRef(focusRequest);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => setViewport(viewportRef.current), [viewportRef]);
  const searched = query.trim() ? query : '';
  const find = useFindSession({ query: searched, root, viewportRef, barRef, turnCount, include });
  const { rerun } = find;

  useEffect(() => {
    const input = inputRef.current;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      !barRef.current?.contains(active) &&
      active !== document.body
    ) {
      returnFocus.current = active;
    }
    input?.focus({ preventScroll: true });
    input?.select();
    // Opening searches through the query's own first run; a later request searches again.
    if (requested.current !== focusRequest) {
      requested.current = focusRequest;
      rerun();
    }
  }, [focusRequest, rerun]);

  const close = () => {
    const target = returnFocus.current;
    const active = document.activeElement;
    const focusInBar = !active || active === document.body || barRef.current?.contains(active);
    if (target?.isConnected && focusInBar) target.focus({ preventScroll: true });
    onClose();
  };

  return (
    <>
      <FindBar
        barRef={barRef}
        inputRef={inputRef}
        text={text}
        searching={searched !== ''}
        total={find.hits.length}
        current={find.current}
        onChange={change}
        compositionProps={compositionProps}
        onStep={find.step}
        onClose={close}
      />
      <FindRuler viewport={viewport} hits={find.hits} current={find.current} onPick={find.pick} />
    </>
  );
}
