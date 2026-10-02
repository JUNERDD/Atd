import { useEffect, useRef, useState } from 'react';
import { matchFields } from '@atd/ui/lib/fuzzy-match';
import type { FileRef } from '../../client/agent/task-schema';
import type { FileSearchReply, FileSearchResult } from '@atd/agent-contracts';

const DEBOUNCE_MS = 120;
/** Recent files for an empty query, search matches otherwise (plan 1.9). */
const RECENT_LIMIT = 8;
const MATCH_LIMIT = 20;

export type FileSearchState =
  | { status: 'unavailable'; reason: 'desktop' | 'indexDisabled' | 'unsupported' | 'failed' }
  | { status: 'loading' }
  | {
      status: 'ready';
      /** Each `match` belongs to the current query. */
      results: FileSearchResult[];
      partial: boolean;
      /** Reads and uploads the files behind the ids (main process); rejects with English errors. */
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

function unavailableReason(settled: Settled): 'indexDisabled' | 'unsupported' | 'failed' {
  if (settled.state === 'failed') return 'failed';
  return settled.reason === 'indexDisabled' ? 'indexDisabled' : 'unsupported';
}

/**
 * System file search for the `@` file group (contract F.2). A query goes out after a 120 ms pause
 * in typing; the editor holds the trigger still while an IME composes, so composing text never
 * searches. Requests are numbered and only the newest reply lands (`superseded` replies are
 * dropped too). While a request is in flight the previous batch stays, narrowed to names that
 * still match the query and marked for it by the shared matcher: the list does not jump, and
 * Enter cannot pick a stale file that no longer matches. A rejected search reads as unavailable
 * for that query, without a toast.
 * `live` is the panel's open state: each opening searches afresh and ignores earlier replies,
 * while a closing panel keeps its last rows for the exit animation.
 */
export function useFileSearch(live: boolean, query: string): FileSearchState {
  const bridge = window.desktop?.files;
  const [opening, setOpening] = useState({ live, count: 0 });
  if (opening.live !== live) setOpening({ live, count: opening.count + (live ? 1 : 0) });
  const [latest, setSettled] = useState<Settled | null>(null);
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
  }, [live, bridge, query, count]);

  if (!bridge) return { status: 'unavailable', reason: 'desktop' };
  const settled = latest?.opening === count ? latest : null;
  if (!settled) return { status: 'loading' };
  const attach = (resultIds: string[]) => bridge.attach(resultIds);
  const found = settled.state === 'ok' || settled.state === 'partial';
  if (settled.query === query) {
    return found
      ? { status: 'ready', results: settled.results, partial: settled.state === 'partial', attach }
      : { status: 'unavailable', reason: unavailableReason(settled) };
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
  return kept.length
    ? { status: 'ready', results: kept, partial: false, attach }
    : { status: 'loading' };
}
