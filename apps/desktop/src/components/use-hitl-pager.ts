import { useState } from 'react';
import type { PermissionRequest } from '../client/agent/permission-schema';

interface Selection {
  /** The request on screen; null while nothing waits. */
  id: string | null;
  /** Where it sat, so a resolved request hands its place to the one that moves up into it. */
  index: number;
  /** The request whose controls take focus: only one that arrived while nothing was waiting. */
  focusId: string | null;
}

export interface HitlPager {
  request: PermissionRequest | null;
  /** Zero-based position of `request`. */
  position: number;
  count: number;
  /** Whether `request` should focus its first action when it mounts. */
  focusOnMount: boolean;
  go: (delta: -1 | 1) => void;
}

/**
 * One pending request at a time. The selection follows the request's id, so arrivals and
 * resolutions elsewhere in the list keep it in place; resolving the shown request moves to the
 * next one in its slot (the previous one at the end). Focus moves into a request only when it
 * arrives while nothing was waiting: paging keeps focus on the pager, and the request that
 * follows a resolved one never takes it, so a repeated Enter cannot answer a request the user
 * has not seen.
 */
export function useHitlPager(requests: readonly PermissionRequest[]): HitlPager {
  const [selection, setSelection] = useState<Selection>({ id: null, index: 0, focusId: null });
  const found = selection.id === null ? -1 : requests.findIndex(({ id }) => id === selection.id);
  const position = found >= 0 ? found : Math.max(0, Math.min(selection.index, requests.length - 1));
  const request = requests[position] ?? null;
  const id = request?.id ?? null;
  if (id !== selection.id || position !== selection.index) {
    const arrived = selection.id === null && id !== null;
    setSelection({
      id,
      index: position,
      focusId: id === selection.id ? selection.focusId : arrived ? id : null,
    });
  }
  return {
    request,
    position,
    count: requests.length,
    focusOnMount: id !== null && id === selection.focusId,
    go: (delta) => {
      const target = requests[position + delta];
      if (target) setSelection({ id: target.id, index: position + delta, focusId: null });
    },
  };
}
