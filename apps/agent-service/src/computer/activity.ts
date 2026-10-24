import type {
  ComputerActivityOperation,
  ComputerActivityProblem,
  ComputerActivityTarget,
} from '@atd/agent-contracts';

export interface ActivityIdentity {
  taskId: string;
  runId: string;
  toolCallId: string;
}

/** The call-owned facts; the projection joins lifecycle and pending input from the ledger. */
export interface ComputerActivityObservation {
  taskId: string;
  runId: string;
  fromCommand: boolean;
  startedAt: string;
  updatedAt: string;
  operation: ComputerActivityOperation;
  target?: ComputerActivityTarget;
  problem?: ComputerActivityProblem;
}

/** Display facts only. No authorization, target refs, arguments, captures or pixels survive here. */
export class ComputerActivityBoard {
  private readonly runs = new Map<string, ComputerActivityObservation>();
  private readonly listeners = new Set<() => void>();

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Map insertion order is the first observed order, unchanged by later calls of the run. */
  entries(): ReadonlyMap<string, ComputerActivityObservation> {
    return this.runs;
  }

  begin(
    identity: ActivityIdentity,
    fields: {
      fromCommand: boolean;
      operation: Omit<ComputerActivityOperation, 'toolCallId' | 'inFlight'>;
      target?: ComputerActivityTarget;
    },
  ): void {
    const key = this.key(identity);
    const previous = this.runs.get(key);
    const at = new Date().toISOString();
    const target = fields.target;
    this.runs.set(key, {
      taskId: identity.taskId,
      runId: identity.runId,
      fromCommand: fields.fromCommand,
      startedAt: previous?.startedAt ?? at,
      updatedAt: at,
      operation: { ...fields.operation, toolCallId: identity.toolCallId, inFlight: true },
      ...(target ? { target } : {}),
    });
    this.changed();
  }

  /** A validated access candidate can identify the app before its approval creates a binding. */
  target(identity: ActivityIdentity, target: ComputerActivityTarget): void {
    const current = this.current(identity);
    if (!current) return;
    current.target = target;
    current.updatedAt = new Date().toISOString();
    this.changed();
  }

  /** A late completion of an older tool call never replaces the run's newer operation. */
  end(
    identity: ActivityIdentity,
    fields: {
      target?: ComputerActivityTarget;
      step?: { kind: NonNullable<ComputerActivityOperation['stepKind']>; summary: string };
      problem?: ComputerActivityProblem;
    },
  ): void {
    const current = this.current(identity);
    if (!current) return;
    current.operation = {
      ...current.operation,
      inFlight: false,
      ...(fields.step ? { stepKind: fields.step.kind, summary: fields.step.summary } : {}),
    };
    if (fields.target) current.target = fields.target;
    if (fields.problem) current.problem = fields.problem;
    else delete current.problem;
    current.updatedAt = new Date().toISOString();
    this.changed();
  }

  /** Called inside the projection's own refresh, which publishes the resulting replacement. */
  forget(key: string): void {
    this.runs.delete(key);
  }

  private current(identity: ActivityIdentity): ComputerActivityObservation | undefined {
    const entry = this.runs.get(this.key(identity));
    return entry?.operation.toolCallId === identity.toolCallId ? entry : undefined;
  }

  private key(identity: Pick<ActivityIdentity, 'taskId' | 'runId'>): string {
    return `${identity.taskId}/${identity.runId}`;
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
