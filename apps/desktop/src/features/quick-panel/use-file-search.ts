import { useEffect, useRef, useState } from 'react';
import { matchFields } from '@atd/ui/lib/fuzzy-match';
import type { FileRef } from '../../client/agent/task-schema';
import type { FileSearchReply, FileSearchResult } from '@atd/agent-contracts';

const DEBOUNCE_MS = 120;
/** Recent files for an empty query, search matches otherwise (plan 1.9). */
const RECENT_LIMIT = 8;
const MATCH_LIMIT = 20;
/** While the index is still being built or reopened, an open panel asks again this often. */
const REFRESH_MS = 2000;

/**
 * Why file search offers nothing: no desktop bridge, no file search on this system, an index the
 * service is still trying to open, or a request that failed.
 */
export type FileSearchOff = 'desktop' | 'unsupported' | 'retrying' | 'failed';

export type FileSearchState =
  | { status: 'unavailable'; reason: FileSearchOff }
  | { status: 'loading' }
  | {
      status: 'ready';
      /** Each `match` belongs to the current query. */
      results: FileSearchResult[];
      /**
       * `partial`: the search ran out of time or the index fell behind, so files may be missing.
       * `indexing`: the index is still being built; the rows cover the files found so far.
       */
      coverage: 'complete' | 'partial' | 'indexing';
      /** Stores the files behind the ids as resources (service); rejects with a message to show. */
      attach: (resultIds: string[]) => Promise<FileRef[]>;
    };

interface Settled {
  /** The panel opening this reply belongs to; result ids expire in main, so openings never share. */
  opening: number;
  query: string;
  state: Exclude<FileSearchReply['state'], 'superseded'> | 'failed';
  reason: FileSearchReply['reason'];
  results: FileSearchResult[];
}

function unavailableReason(settled: Settled): Exclude<FileSearchOff, 'desktop'> {
  if (settled.state === 'failed') return 'failed';
  return settled.reason === 'retrying' ? 'retrying' : 'unsupported';
}

/** Whether the answer can still change without typing: the service is building its index. */
function settling(settled: Settled): boolean {
  return settled.state === 'indexing' || settled.reason === 'retrying';
}

/**
 * System file search for the `@` file group (contract F.2). A query goes out after a 120 ms pause
 * in typing; the editor holds the trigger still while an IME composes, so composing text never
 * searches. Requests are numbered and only the newest reply lands (`superseded` replies are
 * dropped too). While a request is in flight the previous batch stays, narrowed to names that
 * still match the query and marked for it by the shared matcher: the list does not jump, and
 * Enter cannot pick a stale file that no longer matches. A rejected search reads as unavailable
 * for that query, without a toast. While the index is still being built (or the service retries
 * opening it) the open panel asks again every `REFRESH_MS`, so files appear without typing; rows
 * keep their ids across those replies.
 * `live` is the panel's open state: each opening searches afresh and ignores earlier replies,
 * while a closing panel keeps its last rows for the exit animation.
 */
export function useFileSearch(live: boolean, query: string): FileSearchState {
  const bridge = window.desktop?.files;
  const [opening, setOpening] = useState({ live, count: 0 });
  if (opening.live !== live) setOpening({ live, count: opening.count + (live ? 1 : 0) });
  const [latest, setSettled] = useState<Settled | null>(null);
  const [round, setRound] = useState(0);
  const sequence = useRef(0);
  const count = opening.count;
  useEffect(() => {
    if (!live || !bridge) return;
    const request = ++sequence.current;
    const timer = setTimeout(() => {
      bridge.search({ query, limit: query ? MATCH_LIMIT : RECENT_LIMIT }).then(
        (reply) => {
          if (request !== sequence.current || reply.state === 'superseded') return;
          const { state, reason, results } = reply;
          setSettled({ opening: count, query, state, reason, results });
        },
        () => {
          if (request !== sequence.current) return;
          setSettled({ opening: count, query, state: 'failed', reason: undefined, results: [] });
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [live, bridge, query, count, round]);

  const settled = latest?.opening === count ? latest : null;
  // Each reply that is still settling arms the next round; typing or closing cancels it.
  useEffect(() => {
    if (!live || !settled || settled.query !== query || !settling(settled)) return;
    const timer = setTimeout(() => setRound((value) => value + 1), REFRESH_MS);
    return () => clearTimeout(timer);
  }, [live, settled, query]);

  if (!bridge) return { status: 'unavailable', reason: 'desktop' };
  if (!settled) return { status: 'loading' };
  const attach = (resultIds: string[]) => bridge.attach(resultIds);
  const { state } = settled;
  const found = state === 'ok' || state === 'partial' || state === 'indexing';
  if (settled.query === query) {
    if (!found) return { status: 'unavailable', reason: unavailableReason(settled) };
    const coverage = state === 'ok' ? 'complete' : state;
    return { status: 'ready', results: settled.results, coverage, attach };
  }
  // A backend that is off stays off between keystrokes; keep its reason instead of flickering.
  if (settled.state === 'unavailable')
    return { status: 'unavailable', reason: unavailableReason(settled) };
  const kept = found
    ? settled.results.flatMap((result) => {
        const match = matchFields(query, { name: result.name });
        return match ? [{ ...result, match: match.ranges.name }] : [];
      })
    : [];
  // A timeout belonged to the earlier query; an index still being built is still being built.
  const coverage = settled.state === 'indexing' ? 'indexing' : 'complete';
  return kept.length ? { status: 'ready', results: kept, coverage, attach } : { status: 'loading' };
}
