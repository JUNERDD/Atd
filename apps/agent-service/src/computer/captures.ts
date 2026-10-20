import type { ComputerCapture, ComputerRect } from '@atd/agent-contracts';

/** Captures kept per run; the oldest is forgotten first, so a long run holds a bounded set. */
const MAX_CAPTURES_PER_RUN = 32;

/** A capture a run's `observe` received, as far as the service checks points against it. */
export interface KnownCapture {
  id: string;
  taskId: string;
  runId: string;
  /** The target ref the observation was of. */
  targetRefId: string;
  observationRefId?: string;
  hostGeneration: number;
  width: number;
  height: number;
  surfaceRefId?: string | undefined;
}

/**
 * The captures each run observed (contract spec §4), in memory only: an image point or a region
 * may name only a capture the service saw for the same run and target ref, within its pixels.
 * The host keeps the authoritative mapping and rechecks the window before acting; this registry
 * only refuses points no capture of the run could explain. Cleared with the run's targets.
 */
export class CaptureRegistry {
  private readonly captures = new Map<string, KnownCapture>();

  remember(entry: Omit<KnownCapture, 'width' | 'height' | 'id'>, capture: ComputerCapture): void {
    this.captures.delete(capture.id);
    const own = [...this.captures.values()].filter((item) => item.runId === entry.runId);
    for (const old of own.slice(0, Math.max(0, own.length - MAX_CAPTURES_PER_RUN + 1)))
      this.captures.delete(old.id);
    this.captures.set(capture.id, {
      ...entry,
      id: capture.id,
      width: capture.width,
      height: capture.height,
      ...(capture.surfaceRefId ? { surfaceRefId: capture.surfaceRefId } : {}),
    });
  }

  /** A capture of this run and target ref, of the current host generation. */
  find(
    runId: string,
    targetRefId: string,
    captureId: string,
    hostGeneration: number | null,
  ): KnownCapture | undefined {
    const known = this.captures.get(captureId);
    if (!known || known.runId !== runId || known.targetRefId !== targetRefId) return undefined;
    return known.hostGeneration === hostGeneration ? known : undefined;
  }

  forgetRun(runId: string): void {
    for (const [id, known] of this.captures) if (known.runId === runId) this.captures.delete(id);
  }

  forgetTarget(targetRefId: string): void {
    for (const [id, known] of this.captures)
      if (known.targetRefId === targetRefId) this.captures.delete(id);
  }

  clear(): void {
    this.captures.clear();
  }
}

/** Whether a pixel lies inside a capture. */
export function pointInCapture(capture: KnownCapture, x: number, y: number): boolean {
  return x < capture.width && y < capture.height;
}

/** Whether a rectangle in capture pixels is non-empty and lies inside the capture. */
export function rectInCapture(capture: KnownCapture, rect: ComputerRect): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= capture.width &&
    rect.y + rect.height <= capture.height
  );
}
