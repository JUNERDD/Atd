import { FLUSH_MARKER, PAUSE_MARKER, writeMarker } from './markers';

/**
 * T6 pure client: the desktop holds no local executions or Hermes store, so
 * migration pause+flush is trivially quiesced. Markers record the state the
 * service CLI import requires. No runtime close path remains.
 */
export function activeTaskCount(): number {
  return 0;
}

/** The pure client never has local active runs to block migration. */
export function assertQuiesced(): void {
  return;
}

/**
 * Records pause+flush markers for the service CLI import. No worker shutdown
 * is needed; the desktop runs no executions after the T6 client migration.
 */
export async function pauseAndFlush(): Promise<{ pausedAt: string; flushedAt: string }> {
  const paused = await writeMarker(PAUSE_MARKER, {
    serviceId: null,
    note: 'Desktop is a pure client; no local executions to pause.',
  });
  const flushed = await writeMarker(FLUSH_MARKER, {
    serviceId: null,
    note: 'No local Hermes store; nothing to flush.',
  });
  return { pausedAt: paused.at, flushedAt: flushed.at };
}
