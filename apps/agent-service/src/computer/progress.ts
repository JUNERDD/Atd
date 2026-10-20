import { isNewerProgress, type ComputerProgress } from '@atd/agent-contracts';

/**
 * Live progress of computer actions (D8): display state only, never an event-log event. Only the
 * latest frame per run is kept, in memory, so a reconnecting renderer reads it through
 * `GET /v1/computer/progress`; every accepted frame is also pushed to the stream connections
 * subscribed to its task. A frame of another host generation, an older `seq` or past its
 * `validUntil` is dropped; a `cleared` frame is forwarded but never listed.
 */
export class ProgressBoard {
  private readonly latest = new Map<string, ComputerProgress>();
  private readonly listeners = new Set<(progress: ComputerProgress) => void>();

  /** Registers a listener of accepted frames; the returned function removes it. */
  onProgress(listener: (progress: ComputerProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Accepts a frame of the bound host's generation for a run that is acting, or drops it.
   * Answers whether it was accepted.
   */
  accept(progress: ComputerProgress, hostGeneration: number, now = Date.now()): boolean {
    if (progress.hostGeneration !== hostGeneration) return false;
    if (!(Date.parse(progress.validUntil) > now)) return false;
    if (!isNewerProgress(this.latest.get(progress.runId), progress)) return false;
    // A `cleared` frame stays as the run's latest, so an older frame arriving after it is dropped.
    this.latest.set(progress.runId, progress);
    for (const listener of this.listeners) listener(progress);
    return true;
  }

  /** The latest frame of each of a task's runs that is still valid. */
  forTask(taskId: string, now = Date.now()): ComputerProgress[] {
    const frames: ComputerProgress[] = [];
    for (const [runId, progress] of this.latest) {
      if (!(Date.parse(progress.validUntil) > now)) this.latest.delete(runId);
      else if (progress.taskId === taskId && progress.phase !== 'cleared') frames.push(progress);
    }
    return frames;
  }

  /** Forgets a run's frame (the run stopped or its host went away). */
  clearRun(runId: string): void {
    this.latest.delete(runId);
  }

  /** Forgets every frame (the host changed generation). */
  clear(): void {
    this.latest.clear();
  }
}
