import { useState } from 'react';
import type { PillView } from '../features/agent/progress/progress-pill';

/**
 * Which view the one popover above the composer shows, or null while it is closed.
 *
 * HITL content (requests and queued messages) opens it by itself: any change to that content
 * reopens it after a dismiss, so an arrival is never missed, while an unchanged queue stays
 * dismissed. A view the user picked from the pill (Todos, Subagents) gives way only to a newly
 * arrived request, which blocks the run; queue edits and resolved requests leave it in place.
 * `recall` changing (the `/queue` command) reopens HITL content.
 */
export function useComposerView({
  signature,
  requestIds,
  hasHitl,
  recall,
}: {
  /** Changes whenever the HITL content does. */
  signature: string;
  requestIds: readonly string[];
  hasHitl: boolean;
  recall: number;
}) {
  const [view, setView] = useState<PillView | null>(hasHitl ? 'hitl' : null);
  // Adjusted during render, so the popover never paints a frame with the stale view.
  const [seen, setSeen] = useState({ signature, requestIds });
  if (seen.signature !== signature) {
    setSeen({ signature, requestIds });
    const picked = view === 'todos' || view === 'subagents';
    const arrived = requestIds.some((id) => !seen.requestIds.includes(id));
    if (!picked || arrived) setView(hasHitl ? 'hitl' : null);
  }
  const [recalled, setRecalled] = useState(recall);
  if (recalled !== recall) {
    setRecalled(recall);
    if (hasHitl) setView('hitl');
  }
  return [view, setView] as const;
}
