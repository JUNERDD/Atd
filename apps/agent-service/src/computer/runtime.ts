import {
  COMPUTER_ADDONS,
  COMPUTER_BROWSER_ADDON,
  computerEngineFor,
  type ComputerCancelReason,
  type ComputerEngine,
} from '@atd/agent-contracts';
import type { AddonRegistry } from '../addons/index.js';
import type { Logger } from '../logging.js';
import { ComputerAccess } from './access.js';
import { ComputerActivityBoard } from './activity.js';
import { ComputerBindingStore } from './bindings.js';
import { ComputerCoordinator } from './coordinator.js';
import { REFUSE_ALL_GRANTS, type ComputerGrantCheck } from './grant-check.js';
import { ComputerRecords } from './records.js';
import { VISUAL_QUALIFICATION_ENV, visualOverrideEnabled } from './visual-qualifications.js';

/**
 * The add-on that provides each engine that is not built in (design §1): the host runs such an
 * engine only while its add-on is installed. The native engine (`atd`) ships inside the app, so it
 * has no add-on and is always installed. The person's own Chrome (`chrome`) needs the browser
 * add-on too: its Playwright worker drives the tabs Atd for Chrome hands to a run.
 */
const COMPUTER_ADDON_FOR_ENGINE: Readonly<Partial<Record<ComputerEngine, string>>> = {
  playwright: COMPUTER_BROWSER_ADDON,
  chrome: COMPUTER_BROWSER_ADDON,
};

/** Why a computer add-on cannot be removed while computer use acts (`AddonUseCheck`). */
const IN_USE =
  'Computer use is acting on a target right now. Wait for it to finish or stop it, then remove the add-on.';
/** How long to wait for the bound host's `computer.hello` to advertise a freshly updated engine. */
const HOST_PROFILE_WAIT_MS = 5_000;

/**
 * The service's computer-use module, built once by the composition root (index.ts) and shared
 * through `RunnerContext.computer`: the binding store, the durable facts, the host coordinator
 * and the live grant check the policy consults. The automations module receives `bindings` and
 * calls `cancelRun` / `stopAll`; it supplies the real grant check through `setGrantCheck`. The
 * composition root says whether the service runs for development.
 */
export class ComputerRuntime {
  readonly activity = new ComputerActivityBoard();
  private grantCheck: ComputerGrantCheck = REFUSE_ALL_GRANTS;

  private constructor(
    readonly dataDir: string,
    readonly bindings: ComputerBindingStore,
    readonly access: ComputerAccess,
    readonly records: ComputerRecords,
    readonly coordinator: ComputerCoordinator,
    private readonly addons: AddonRegistry,
    /**
     * Whether visual steps of an `unverified` model are allowed for qualification runs
     * (`VISUAL_QUALIFICATION_ENV`, development services only); every use is audited.
     */
    readonly visualOverride: boolean,
  ) {}

  static async create(options: {
    dataDir: string;
    log: Logger;
    addons: AddonRegistry;
    /** The service runs with `--development`; absent counts as a packaged service. */
    development?: boolean;
  }): Promise<ComputerRuntime> {
    const { log } = options;
    const [bindings, records] = await Promise.all([
      ComputerBindingStore.load(options.dataDir, log),
      ComputerRecords.load(options.dataDir),
    ]);
    const access = await ComputerAccess.load(options.dataDir, bindings);
    const coordinator = new ComputerCoordinator(records, log);
    options.addons.useBy(COMPUTER_ADDONS, () => (coordinator.inFlight() ? IN_USE : null));
    const visualOverride = visualOverrideEnabled(options.development ?? false);
    if (visualOverride) log.warn('Visual computer steps are allowed for qualification runs.');
    else if (process.env[VISUAL_QUALIFICATION_ENV] !== undefined)
      log.warn(`${VISUAL_QUALIFICATION_ENV} is ignored outside a development service.`);
    return new ComputerRuntime(
      options.dataDir,
      bindings,
      access,
      records,
      coordinator,
      options.addons,
      visualOverride,
    );
  }

  /**
   * Whether the engine of at least one of these targets is installed, read when a run freezes its
   * material: an app target always has its built-in engine, a browser target (managed or the
   * person's own Chrome) needs the browser engine's add-on. Targets that no longer exist count
   * for nothing.
   */
  hasEngineFor(bindingIds: readonly string[]): boolean {
    return bindingIds.some((id) => {
      const binding = this.bindings.get(id);
      return binding !== undefined && this.engineInstalled(computerEngineFor(binding));
    });
  }

  /** Whether an engine can run: it is built in, or its add-on is installed. */
  engineInstalled(engine: ComputerEngine): boolean {
    return this.missingAddon(engine) === undefined;
  }

  /**
   * Ensures an engine's add-on is current when an earlier version is already installed (`outdated`):
   * awaits/starts the background update and, for any add-on-backed engine, waits briefly for
   * `computer.hello` if a host is bound without that engine's profile yet. Never installs an
   * add-on the user has not installed.
   */
  async ensureEngineInstalled(engine: ComputerEngine, signal?: AbortSignal): Promise<boolean> {
    const addon = COMPUTER_ADDON_FOR_ENGINE[engine];
    if (addon === undefined) return true;
    if (this.addons.installed(addon) === undefined) {
      const installed = await this.addons.ensureInstalled(addon, signal);
      if (!installed) return false;
    }
    await this.waitForHostProfile(engine, signal);
    return this.engineInstalled(engine);
  }

  /** Ensures outdated add-ons for any of `bindingIds` finish updating before checking availability. */
  async ensureEnginesFor(bindingIds: readonly string[], signal?: AbortSignal): Promise<boolean> {
    const engines = [
      ...new Set(
        bindingIds.flatMap((id) => {
          const binding = this.bindings.get(id);
          return binding ? [computerEngineFor(binding)] : [];
        }),
      ),
    ];
    await Promise.all(engines.map((engine) => this.ensureEngineInstalled(engine, signal)));
    return this.hasEngineFor(bindingIds);
  }

  /**
   * Truthful message when an already-installed add-on is still `outdated` after an update attempt;
   * `undefined` when the add-on was never installed (caller keeps its "not installed" copy).
   */
  addonUnavailableMessage(addonId: string): string | undefined {
    if (!this.addons.isOutdated(addonId)) return undefined;
    const view = this.addons.view(addonId);
    const name = addonId === COMPUTER_BROWSER_ADDON ? 'browser engine' : `"${addonId}" add-on`;
    if (!view.available)
      return `The installed ${name} is outdated for this build and no matching update archive is available. Check Settings → Computer use → Engines.`;
    const error = this.addons.lastUpdateError(addonId);
    if (error)
      return `The ${name} is already installed, but its automatic update failed (${error.message}). Check your connection or update it in Settings → Computer use → Engines.`;
    return `The ${name} update for this build has not completed yet. Check Settings → Computer use → Engines.`;
  }

  /** Distinguishes an outdated engine whose update failed from one the user never installed. */
  engineUnavailableReason(engine: ComputerEngine, fallback: string): string {
    const addon = this.missingAddon(engine);
    return (addon !== undefined ? this.addonUnavailableMessage(addon) : undefined) ?? fallback;
  }

  /** The add-on an engine needs that is not installed, or undefined (built in or installed). */
  missingAddon(engine: ComputerEngine): string | undefined {
    const addon = COMPUTER_ADDON_FOR_ENGINE[engine];
    return addon === undefined || this.addons.installed(addon) !== undefined ? undefined : addon;
  }

  private waitForHostProfile(engine: ComputerEngine, signal?: AbortSignal): Promise<void> {
    if (
      this.coordinator.hostGeneration() === null ||
      this.coordinator.profile(engine) !== undefined
    )
      return Promise.resolve();
    signal?.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      let done = false;
      let timer: NodeJS.Timeout | undefined;
      let offHost: (() => void) | undefined;
      const onAbort = () => {
        if (done) return;
        done = true;
        cleanup();
        reject(signal?.reason ?? new Error('Aborted'));
      };
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        offHost?.();
        signal?.removeEventListener('abort', onAbort);
      };
      offHost = this.coordinator.onHostChanged(() => {
        if (
          this.coordinator.hostGeneration() === null ||
          this.coordinator.profile(engine) !== undefined
        )
          finish();
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(finish, HOST_PROFILE_WAIT_MS);
      timer.unref();
      if (
        this.coordinator.hostGeneration() === null ||
        this.coordinator.profile(engine) !== undefined
      )
        finish();
    });
  }

  /**
   * The injection point of the automations module's live grant and trial check (D11). Until it
   * is called every grant and trial counts as missing (`REFUSE_ALL_GRANTS`), so recipe-bound
   * runs refuse every action.
   */
  setGrantCheck(check: ComputerGrantCheck): void {
    this.grantCheck = check;
  }

  /** The grant check in force, read per action so a later injection applies at once. */
  grants(): ComputerGrantCheck {
    return this.grantCheck;
  }

  /** Stops one run's computer work (see `ComputerCoordinator.cancelRun`). */
  async cancelRun(taskId: string, runId: string, reason: ComputerCancelReason): Promise<void> {
    try {
      await this.coordinator.cancelRun(taskId, runId, reason);
    } finally {
      this.access.forget(runId);
    }
  }

  /** Stops every run's computer work; answers the runs it stopped. */
  async stopAll(reason: ComputerCancelReason): Promise<string[]> {
    const runs = await this.coordinator.stopAll(reason);
    for (const runId of runs) this.access.forget(runId);
    return runs;
  }
}
