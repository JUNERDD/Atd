import { useState } from 'react';
import type { InputRequest } from '../../../client/agent/permission-schema';

/**
 * Whether the view's call waits for the user, held from its input request on: once answered, the
 * call still runs until its result arrives, and its view stays ready meanwhile (`viewPhase`).
 */
export function useWaited(request: InputRequest | undefined): boolean {
  const [waited, setWaited] = useState(request !== undefined);
  if (request && !waited) setWaited(true);
  return waited || request !== undefined;
}

/**
 * Which load of a view's document a surface mounts, for its widget card and its window alike. A
 * frame that never answered the handshake, or that another document replaced, reports itself
 * lost (`useViewHost`) and offers `retry`, which mounts a new load. A rewind that took back data
 * the frame already applied (`revision` going down) mounts a new load too, since only a fresh
 * document undoes what the view applied. Key the frame by `mount`.
 */
export function useViewMount(revision: number) {
  const [mount, setMount] = useState(0);
  const [lostMount, setLostMount] = useState<number | null>(null);
  const [seenRevision, setSeenRevision] = useState(revision);
  if (revision !== seenRevision) {
    setSeenRevision(revision);
    if (revision < seenRevision) setMount((value) => value + 1);
  }
  return {
    mount,
    lost: lostMount === mount,
    /** For the frame of this `mount`: it cannot show its view. */
    onLost: () => setLostMount(mount),
    retry: () => setMount(mount + 1),
  };
}
