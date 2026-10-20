import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { isNewerProgress, type ComputerProgress } from '@atd/agent-contracts';
import type { ComputerBridge } from '../../client/computer-contract';
import { computerBridge } from './use-computer';

/**
 * The latest live progress of each run, as the activity rows show it. The host sends a frame per
 * step phase; this keeps only the newest per run (`isNewerProgress`: a newer host generation, or
 * a higher `seq` within one) and drops the rest, so a late frame never draws an older phase over
 * a newer one. A frame past its `validUntil` or a `cleared` one shows nothing: no stale phase
 * stays on a row whose target already changed.
 */
const latest = new Map<string, ComputerProgress>();
const listeners = new Set<() => void>();
/** Tasks whose stored progress this window read once, after it first showed them. */
const seeded = new Set<string>();
let wired: { bridge: ComputerBridge; stop: () => void } | null = null;

function accept(progress: ComputerProgress) {
  if (!isNewerProgress(latest.get(progress.runId), progress)) return;
  latest.set(progress.runId, progress);
  for (const listener of listeners) listener();
}

function wire(bridge: ComputerBridge) {
  if (wired?.bridge === bridge) return;
  wired?.stop();
  latest.clear();
  seeded.clear();
  const stopProgress = bridge.onProgress(accept);
  // A reconnect may have missed frames: the next view reads the stored progress again.
  const stopChange = bridge.onChange(() => seeded.clear());
  wired = {
    bridge,
    stop: () => {
      stopProgress();
      stopChange();
    },
  };
}

import.meta.hot?.dispose(() => {
  wired?.stop();
  wired = null;
});

/**
 * The live progress of run `runId` of task `taskId` while it is current, else null. The first
 * view of a task reads the service's stored progress, so a window opened mid-action shows it too;
 * the row then follows the stream and redraws when the frame it shows expires.
 */
export function useComputerProgress(
  taskId: string | null,
  runId: string | null,
): ComputerProgress | null {
  const bridge = computerBridge();
  if (bridge) wire(bridge);
  useEffect(() => {
    if (!bridge || !taskId || seeded.has(taskId)) return;
    seeded.add(taskId);
    bridge.progress(taskId).then(
      (frames) => frames.forEach(accept),
      // Live frames still arrive; a later view of the task tries the stored ones again.
      () => seeded.delete(taskId),
    );
  }, [bridge, taskId]);
  const subscribe = useCallback((notify: () => void) => {
    listeners.add(notify);
    return () => void listeners.delete(notify);
  }, []);
  const frame = useSyncExternalStore(subscribe, () => (runId ? (latest.get(runId) ?? null) : null));
  // The frame whose `validUntil` passed; it shows no longer. The clock is read in the effect.
  const [expired, setExpired] = useState<ComputerProgress | null>(null);
  useEffect(() => {
    if (!frame) return;
    const wait = Math.max(0, Date.parse(frame.validUntil) - Date.now());
    const timer = setTimeout(() => setExpired(frame), Number.isFinite(wait) ? wait + 1 : 0);
    return () => clearTimeout(timer);
  }, [frame]);
  return frame && frame !== expired && frame.phase !== 'cleared' ? frame : null;
}
