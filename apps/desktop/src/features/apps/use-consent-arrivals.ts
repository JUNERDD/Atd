import { useEffect, useLayoutEffect, useRef } from 'react';
import type { AppCapabilityConsent } from '@atd/agent-contracts';

/**
 * Runs `onArrive` once for every batch of capability consents the panel has not seen yet. An
 * app's backend call waits on its consent and nothing else alerts the user, so the panel reveals
 * the request as soon as it appears, including those already waiting when the panel loads.
 */
export function useConsentArrivals(
  consents: readonly AppCapabilityConsent[],
  onArrive: () => void,
) {
  const seen = useRef(new Set<string>());
  const latest = useRef(onArrive);
  useLayoutEffect(() => {
    latest.current = onArrive;
  });
  const ids = consents.map(({ id }) => id).join(',');
  useEffect(() => {
    const fresh = ids.split(',').filter((id) => id && !seen.current.has(id));
    fresh.forEach((id) => seen.current.add(id));
    if (fresh.length) latest.current();
  }, [ids]);
}
