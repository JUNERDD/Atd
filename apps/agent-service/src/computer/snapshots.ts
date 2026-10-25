import type { ImageContent } from '@earendil-works/pi-ai';
import type { Observation } from '@atd/agent-contracts';

/** A private full observation for local resolution; only facts and image reach the model. */
export interface ComputerSnapshot {
  observation: Observation;
  facts: Record<string, unknown>;
  image?: ImageContent;
  resourceId?: string;
}

interface KnownSnapshot {
  runId: string;
  targetRefId: string;
  hostGeneration: number;
  snapshot: ComputerSnapshot;
}

const MAX_SNAPSHOT_PAIRS = 16;

/** Latest observation per run and target, kept in memory and invalidated with captures. */
export class SnapshotRegistry {
  private readonly snapshots = new Map<string, KnownSnapshot>();

  remember(
    runId: string,
    targetRefId: string,
    hostGeneration: number,
    snapshot: ComputerSnapshot,
  ): void {
    const key = JSON.stringify([runId, targetRefId]);
    this.snapshots.delete(key);
    this.snapshots.set(key, { runId, targetRefId, hostGeneration, snapshot });
    while (this.snapshots.size > MAX_SNAPSHOT_PAIRS) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest !== undefined) this.snapshots.delete(oldest);
    }
  }

  get(
    runId: string,
    targetRefId: string,
    observationRefId: string,
    hostGeneration: number,
  ): ComputerSnapshot | undefined {
    const known = this.snapshots.get(JSON.stringify([runId, targetRefId]));
    const ref = known?.snapshot.observation.ref;
    return known?.hostGeneration === hostGeneration &&
      ref?.id === observationRefId &&
      ref.targetRefId === targetRefId
      ? known.snapshot
      : undefined;
  }

  /** Most recently observed targets of this run and host, never discovered-but-unobserved refs. */
  latestTargetRefIds(runId: string, hostGeneration: number, limit: number): string[] {
    return [...this.snapshots.values()]
      .reverse()
      .filter((known) => known.runId === runId && known.hostGeneration === hostGeneration)
      .slice(0, limit)
      .map((known) => known.targetRefId);
  }

  forgetTarget(runId: string, targetRefId: string): void {
    this.snapshots.delete(JSON.stringify([runId, targetRefId]));
  }

  forgetRun(runId: string): void {
    for (const [key, known] of this.snapshots)
      if (known.runId === runId) this.snapshots.delete(key);
  }

  clear(): void {
    this.snapshots.clear();
  }
}
