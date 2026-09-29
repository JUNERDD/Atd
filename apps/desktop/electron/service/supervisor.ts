import log from 'electron-log/main';
import { errorMessage } from '../../src/client/agent/validation';
import type { ConnectionState, ServiceConnection } from './connection';
import { startLocalService, stopLocalService, type ServiceExit } from './launcher';

const logger = log.scope('service');

const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 15_000;
/** Uptime after which a restarted service counts as healthy and the backoff starts over. */
const HEALTHY_UPTIME_MS = 60_000;
/** BREAKER_EXITS unexpected exits within this window stop automatic restarts. */
const BREAKER_WINDOW_MS = 5 * 60_000;
const BREAKER_EXITS = 3;
/** Liveness poll for an adopted service while its stream is reconnecting. */
const ADOPTED_POLL_MS = 1000;

const RESTARTING_DETAIL = 'The agent service stopped unexpectedly. Restarting…';
const TRIPPED_DETAIL =
  'The agent service stopped unexpectedly 3 times in 5 minutes, so it was not restarted again. Choose Restart Agent Service from the menu bar menu.';

/**
 * Keeps the local service of the default dataDir running once startup has settled it: a
 * service this process spawned is watched through its exit, and a service autostart adopted
 * (no child handle) through its pid while the stream reconnects. An unexpected exit respawns it
 * through the same spawn-and-connect path after an exponential backoff, until the circuit
 * breaker trips.
 *
 * States: idle (nothing supervised) → watching (spawned child or adopted pid) → on an unexpected
 * exit, waiting (respawn timer) → starting (spawn + connect) → watching again, or back to
 * waiting on failure. The breaker, an intentional stop, and a manual connection change return
 * to idle. Every intentional transition bumps `generation`; exits, timers and spawns of an older
 * generation are ignored, which is what keeps quit, restart and replacement from respawning.
 */
export class ServiceSupervisor {
  private generation = 0;
  /** Times of recent unexpected exits, for the breaker. */
  private exits: number[] = [];
  /** Consecutive restarts since the service last stayed up for HEALTHY_UPTIME_MS. */
  private attempt = 0;
  private adoptedPid: number | null = null;
  private respawnTimer: NodeJS.Timeout | null = null;
  private healthyTimer: NodeJS.Timeout | null = null;
  private adoptedPoll: NodeJS.Timeout | null = null;
  /** The spawn in flight, so a stop never races a process that is still starting. */
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly connection: ServiceConnection,
    private readonly options: { dataDir: () => string; onLive: (live: boolean) => void },
  ) {
    connection.onState((state) => this.followAdopted(state));
  }

  /**
   * Spawns and connects a service, then supervises it. A failure here is shown on the connection
   * and not retried: supervision starts only once a service has come up.
   */
  async start(): Promise<void> {
    const generation = this.invalidate();
    await this.settle();
    try {
      await this.track(this.spawnAndConnect(generation));
    } catch (error) {
      logger.error(`The service did not start: ${errorMessage(error)}`);
      if (generation === this.generation) this.connection.fail(errorMessage(error));
    }
  }

  /** Supervises a service autostart connected to instead of spawning one. */
  adopt(pid: number): void {
    const generation = this.invalidate();
    this.adoptedPid = pid;
    this.startHealthyTimer(generation);
    logger.info(`Supervising the running service (pid ${pid}).`);
  }

  /** Ends supervision without touching the service: a manual connection change took over. */
  release(): void {
    this.invalidate();
  }

  /** Ends supervision, then stops the service. Used on quit; never respawns. */
  async stop(): Promise<void> {
    this.invalidate();
    await this.settle();
    await stopLocalService(this.options.dataDir());
  }

  /** Manual restart: forgets the crash history, stops the service, then starts a new one. */
  async restart(): Promise<void> {
    logger.info('Restarting the service on request.');
    this.exits = [];
    this.attempt = 0;
    this.connection.markStarting('Restarting the agent service…');
    await this.stop();
    await this.start();
  }

  private invalidate(): number {
    this.generation += 1;
    this.clearTimers();
    this.adoptedPid = null;
    return this.generation;
  }

  private clearTimers(): void {
    for (const timer of [this.respawnTimer, this.healthyTimer]) if (timer) clearTimeout(timer);
    if (this.adoptedPoll) clearInterval(this.adoptedPoll);
    this.respawnTimer = null;
    this.healthyTimer = null;
    this.adoptedPoll = null;
  }

  private track(work: Promise<void>): Promise<void> {
    const tracked = work.finally(() => {
      if (this.inflight === tracked) this.inflight = null;
    });
    this.inflight = tracked;
    return tracked;
  }

  private async settle(): Promise<void> {
    try {
      await this.inflight;
    } catch {
      // Its owner already handled the failure.
    }
  }

  /**
   * Returns early without watching when a newer generation took over meanwhile: that owner's
   * own stop covers the process started here.
   */
  private async spawnAndConnect(generation: number): Promise<void> {
    const dataDir = this.options.dataDir();
    const service = await startLocalService({ dataDir });
    if (generation !== this.generation) return;
    await this.connection.connect(dataDir, { quiet: true });
    if (generation !== this.generation) return;
    logger.info(`The service is running (pid ${service.pid}).`);
    this.options.onLive(true);
    this.startHealthyTimer(generation);
    void service.exited.then((exit) =>
      this.onUnexpectedExit(generation, `The service (pid ${service.pid}) ${describeExit(exit)}`),
    );
  }

  private startHealthyTimer(generation: number): void {
    if (this.healthyTimer) clearTimeout(this.healthyTimer);
    this.healthyTimer = setTimeout(() => {
      this.healthyTimer = null;
      if (generation === this.generation) this.attempt = 0;
    }, HEALTHY_UPTIME_MS);
  }

  /**
   * An adopted service has no exit event. A dropped stream alone is not an exit, so while the
   * connection reconnects the pid is polled, and only a gone process counts as one.
   */
  private followAdopted(state: ConnectionState): void {
    const pid = this.adoptedPid;
    if (pid === null) return;
    if (state !== 'reconnecting') {
      if (this.adoptedPoll) clearInterval(this.adoptedPoll);
      this.adoptedPoll = null;
      return;
    }
    if (this.adoptedPoll) return;
    const generation = this.generation;
    const check = () => {
      if (isAlive(pid)) return;
      this.onUnexpectedExit(generation, `The adopted service (pid ${pid}) is gone`);
    };
    this.adoptedPoll = setInterval(check, ADOPTED_POLL_MS);
    check();
  }

  private onUnexpectedExit(generation: number, reason: string): void {
    if (generation !== this.generation) return;
    this.clearTimers();
    this.adoptedPid = null;
    const now = Date.now();
    this.exits = [...this.exits.filter((at) => now - at < BREAKER_WINDOW_MS), now];
    if (this.exits.length >= BREAKER_EXITS) {
      logger.error(`${reason}. ${this.exits.length} unexpected exits in 5 minutes; giving up.`);
      this.invalidate();
      this.connection.fail(TRIPPED_DETAIL);
      return;
    }
    const delay = Math.min(BACKOFF_START_MS * 2 ** this.attempt, BACKOFF_MAX_MS);
    this.attempt += 1;
    logger.warn(`${reason}. Restarting in ${delay} ms.`);
    this.connection.markStarting(RESTARTING_DETAIL);
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null;
      void this.respawn(generation);
    }, delay);
  }

  private async respawn(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    const dataDir = this.options.dataDir();
    try {
      await this.track(
        (async () => {
          // An earlier attempt may have left a process that started but never connected.
          await stopLocalService(dataDir);
          await this.spawnAndConnect(generation);
        })(),
      );
    } catch (error) {
      this.onUnexpectedExit(generation, `The restart failed: ${errorMessage(error)}`);
    }
  }
}

function describeExit(exit: ServiceExit): string {
  return exit.signal
    ? `was stopped by ${exit.signal}`
    : `exited with code ${exit.code ?? 'unknown'}`;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
