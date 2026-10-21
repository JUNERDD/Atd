import { Compile } from 'typebox/compile';
import {
  COMPUTER_PROTOCOL,
  ComputerShellFrameSchema,
  errorMessage,
  type CapabilityProfile,
  type ComputerCancelReason,
  type ComputerCapture,
  type ComputerHelloFrame,
  type ComputerHostState,
  type ExecutionEnvelope,
  type HostOperation,
  type TargetRef,
} from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import { CaptureRegistry, type KnownCapture } from './captures.js';
import {
  PendingRequests,
  type HostLink,
  type HostOutcome,
  type HostTarget,
  type RequestOptions,
  serviceEnvelope,
} from './pending.js';
import { ProgressBoard } from './progress.js';
import type { ComputerRecords } from './records.js';
import { reconcileFacts } from './reconcile.js';
import { SnapshotRegistry } from './snapshots.js';
import { ScreenShareBoard } from './screen-state.js';

export type { HostLink, HostOutcome } from './pending.js';

const ShellFrameValidator = Compile(ComputerShellFrameSchema);

/** Why requests fail while only a host of another computer protocol is connected. */
const OTHER_PROTOCOL =
  'Host speaks an older computer protocol: update Atd so the app and its service match';

/** The connected host that holds the session's computer host lock. */
interface BoundHost extends HostTarget {
  profiles: CapabilityProfile[];
}

/** A target ref a run resolved through `targets`, kept until released or invalidated. */
interface KnownTarget {
  taskId: string;
  runId: string;
  ref: TargetRef;
}

/**
 * The service side of the computer host protocol (D3, D6): the only sender of `computer.request`
 * and `computer.cancel`. It binds the one stream connection whose `computer.hello` says it holds
 * the host lock (any other host is recorded as busy), sends requests to that connection only,
 * accepts replies and progress only from it, and reconciles unresolved actions through `status`
 * on every hello. A host of another computer protocol is never bound. Stopping a run closes its
 * admission for good: later requests of that run are never sent. A foreground step begins and ends
 * within one `act`, so there is no foreground control to report: a run's end reaches the host as a
 * `finished` cancel (task-runner.ts).
 */
export class ComputerCoordinator {
  readonly progress = new ProgressBoard();
  readonly snapshots = new SnapshotRegistry();
  readonly screens = new ScreenShareBoard();
  private readonly captures = new CaptureRegistry();
  private readonly requests: PendingRequests;
  private host: BoundHost | null = null;
  /** Connections that announced a host without the lock. */
  private readonly lockedLinks = new Set<string>();
  /** Connections that announced a host of another computer protocol, which is never bound. */
  private readonly otherProtocolLinks = new Set<string>();
  /** Runs that sent anything, by run id, until they are stopped. */
  private readonly activeRuns = new Map<string, string>();
  private readonly closedRuns = new Set<string>();
  private readonly targets = new Map<string, KnownTarget>();

  constructor(
    private readonly records: ComputerRecords,
    private readonly log: Logger,
  ) {
    this.requests = new PendingRequests(log);
  }

  get serviceEpoch(): string {
    return this.requests.serviceEpoch;
  }

  /** One computer frame from a stream connection; throws on a malformed frame. */
  inbound(link: HostLink, message: unknown): void {
    if (!ShellFrameValidator.Check(message)) throw new TypeError('Malformed computer frame.');
    switch (message.type) {
      case 'computer.hello':
        this.hello(link, message.host);
        return;
      case 'computer.reply':
        this.requests.reply(link.id, message.reply);
        return;
      case 'computer.progress': {
        const { host } = this;
        const { progress } = message;
        if (!host || host.link.id !== link.id) return;
        if (this.activeRuns.get(progress.runId) !== progress.taskId) return;
        this.progress.accept(progress, host.hostGeneration);
        return;
      }
    }
  }

  /** A stream connection closed: a bound host's requests in flight are lost. */
  disconnected(linkId: string): void {
    this.lockedLinks.delete(linkId);
    this.otherProtocolLinks.delete(linkId);
    if (this.host?.link.id !== linkId) return;
    this.unbind();
  }

  /** The host as `GET /v1/computer` reports it. */
  hostStatus(): {
    state: ComputerHostState;
    hostGeneration?: number;
    profiles: CapabilityProfile[];
  } {
    const { host } = this;
    if (host)
      return { state: 'ready', hostGeneration: host.hostGeneration, profiles: host.profiles };
    const busy = this.lockedLinks.size > 0 || this.otherProtocolLinks.size > 0;
    return { state: busy ? 'locked' : 'unavailable', profiles: [] };
  }

  /** The bound host's generation, or null when no host is bound. */
  hostGeneration(): number | null {
    return this.host?.hostGeneration ?? null;
  }

  /** The bound host's profile for an engine, if it published one. */
  profile(engine: CapabilityProfile['engine']): CapabilityProfile | undefined {
    return this.host?.profiles.find((profile) => profile.engine === engine);
  }

  /** Bindings a run is acting on right now. */
  busy(): { bindingId: string; taskId: string; runId: string }[] {
    return this.requests
      .active()
      .flatMap(({ bindingId, taskId, runId }) => (bindingId ? [{ bindingId, taskId, runId }] : []));
  }

  /** Whether any operation is waiting on the host: an engine add-on may not be removed then. */
  inFlight(): boolean {
    return this.requests.active().length > 0;
  }

  /** Whether a run's computer admission is closed (it was stopped). */
  isClosed(runId: string): boolean {
    return this.closedRuns.has(runId);
  }

  /**
   * Sends one operation of a run to the bound host. A stopped run's request and a request without
   * a bound host are never sent (`unsent`).
   */
  request(
    envelope: ExecutionEnvelope,
    op: HostOperation,
    options: RequestOptions,
  ): Promise<HostOutcome> {
    if (this.closedRuns.has(envelope.runId))
      return Promise.resolve({ kind: 'unsent', code: 'cancelled' });
    const { host } = this;
    if (!host)
      return Promise.resolve({
        kind: 'unsent',
        code: 'hostUnavailable',
        ...(this.otherProtocolLinks.size ? { message: OTHER_PROTOCOL } : {}),
      });
    this.activeRuns.set(envelope.runId, envelope.taskId);
    return this.requests.send(host, envelope, op, options);
  }

  /** Keeps the refs a run's `targets` call resolved. */
  rememberTargets(taskId: string, runId: string, refs: readonly TargetRef[]): void {
    for (const ref of refs) this.targets.set(ref.id, { taskId, runId, ref });
  }

  /** A ref the run resolved itself, of the bound host's generation. */
  target(runId: string, refId: string): TargetRef | undefined {
    const known = this.targets.get(refId);
    if (!known || known.runId !== runId) return undefined;
    return known.ref.hostGeneration === this.host?.hostGeneration ? known.ref : undefined;
  }

  forgetTarget(refId: string): void {
    const known = this.targets.get(refId);
    this.targets.delete(refId);
    this.captures.forgetTarget(refId);
    if (known) this.snapshots.forgetTarget(known.runId, refId);
  }

  /** Keeps the capture an observation of a run's target ref returned. */
  rememberCapture(
    entry: { taskId: string; runId: string; targetRefId: string; observationRefId?: string },
    capture: ComputerCapture,
  ): void {
    const { host } = this;
    if (host) this.captures.remember({ ...entry, hostGeneration: host.hostGeneration }, capture);
  }

  /** A capture the run observed of this target ref, of the bound host's generation. */
  capture(runId: string, targetRefId: string, captureId: string): KnownCapture | undefined {
    return this.captures.find(runId, targetRefId, captureId, this.hostGeneration());
  }

  /**
   * Stops a run's computer work (TaskRunner.abort, automation disable or revoke): closes its
   * admission, tells the host to stop the run, and starts the bounded convergence of its requests
   * in flight. Resolves once the cancel is sent; the tool calls waiting on those requests end
   * within `CANCEL_CONVERGENCE_MS`, with the host's terminal reply or as unknown.
   */
  async cancelRun(taskId: string, runId: string, reason: ComputerCancelReason): Promise<void> {
    this.closedRuns.add(runId);
    const acted = this.activeRuns.delete(runId);
    const inFlight = this.requests.active().some((entry) => entry.runId === runId);
    if ((acted || inFlight) && this.host)
      this.host.link.send({ type: 'computer.cancel', runId, reason });
    this.requests.cancelRun(runId);
    this.progress.clearRun(runId);
    this.captures.forgetRun(runId);
    this.snapshots.forgetRun(runId);
    this.screens.forget(runId);
    for (const [refId, known] of this.targets)
      if (known.runId === runId && known.taskId === taskId) this.targets.delete(refId);
  }

  /** Stops every run's computer work (stop-all, shutdown); answers the runs it stopped. */
  async stopAll(reason: ComputerCancelReason): Promise<string[]> {
    const runs = new Map(this.activeRuns);
    for (const entry of this.requests.active()) runs.set(entry.runId, entry.taskId);
    for (const [runId, taskId] of runs) await this.cancelRun(taskId, runId, reason);
    return [...runs.keys()];
  }

  /**
   * Stops the runs acting on a binding that was deleted or changed, and asks the host to release
   * the targets resolved from it.
   */
  async revokeBinding(bindingId: string): Promise<void> {
    const runs = new Map<string, string>();
    for (const entry of this.requests.active())
      if (entry.bindingId === bindingId) runs.set(entry.runId, entry.taskId);
    for (const [runId, taskId] of runs) await this.cancelRun(taskId, runId, 'revoked');
    for (const [refId, known] of this.targets) {
      if (known.ref.bindingId !== bindingId) continue;
      this.forgetTarget(refId);
      void this.release(known);
    }
  }

  private async release(known: KnownTarget): Promise<void> {
    const { host } = this;
    if (!host) return;
    const envelope = serviceEnvelope(known.taskId, known.runId, 'release');
    await this.requests.send(
      host,
      envelope,
      { kind: 'release', targetRef: known.ref },
      {
        timeoutMs: 15_000,
      },
    );
  }

  private hello(link: HostLink, announced: ComputerHelloFrame['host']): void {
    if (announced.protocol !== COMPUTER_PROTOCOL) {
      this.otherProtocolLinks.add(link.id);
      this.lockedLinks.delete(link.id);
      if (this.host?.link.id === link.id) this.unbind();
      this.log.warn('A computer host of another protocol was not bound.', {
        protocol: announced.protocol,
        expected: COMPUTER_PROTOCOL,
      });
      return;
    }
    this.otherProtocolLinks.delete(link.id);
    if (!announced.lockHeld) {
      this.lockedLinks.add(link.id);
      if (this.host?.link.id === link.id) this.unbind();
      return;
    }
    this.lockedLinks.delete(link.id);
    const previous = this.host;
    if (previous && previous.link.id !== link.id) this.requests.dropLink(previous.link.id);
    if (
      previous?.hostGeneration !== announced.hostGeneration ||
      previous.hostId !== announced.hostId
    )
      this.forgetHostState();
    this.host = {
      link,
      hostId: announced.hostId,
      hostGeneration: announced.hostGeneration,
      profiles: announced.profiles,
    };
    const host = this.host;
    void reconcileFacts({
      records: this.records,
      unsettled: announced.unsettled,
      status: (envelope, actionIds) =>
        this.requests.send(host, envelope, { kind: 'status', actionIds }, { timeoutMs: 30_000 }),
    }).catch((error: unknown) =>
      this.log.warn('Computer facts were not reconciled.', { error: errorMessage(error) }),
    );
  }

  private unbind(): void {
    const { host } = this;
    if (!host) return;
    this.host = null;
    this.requests.dropLink(host.link.id);
    this.forgetHostState();
  }

  /** Progress, captures and snapshots belong to one host generation. */
  private forgetHostState(): void {
    this.progress.clear();
    this.captures.clear();
    this.snapshots.clear();
    this.screens.disconnected();
  }
}
