import { useState } from 'react';
import { useServiceStatus } from './use-service';

/**
 * True until this window first sees the service settle: connected, or failed to start. A failure
 * ends it too, so the panel shows the disconnected banner with its settings action instead of
 * loading forever. Later connecting and reconnecting keep the panel content under the banner.
 */
export function useServiceStarting(): boolean {
  const { status, loading } = useServiceStatus();
  const [settled, setSettled] = useState(false);
  const starting = !settled && (loading || status?.state === 'connecting');
  // Once settled, a later connecting state (a restart) never brings the loading back.
  if (!starting && !settled) setSettled(true);
  return starting;
}
