import { readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  APP_CAPABILITIES,
  type AppDetail,
  type AppRuntime,
  type InvalidateFrame,
  type PatchAppGrantsRequest,
} from '@atd/agent-contracts';
import type { EventLog } from '../event-log.js';
import type { Ledger } from '../ledger.js';
import type { Logger } from '../logging.js';
import type { McpAuthority } from '../mcp/index.js';
import type { RunnerManager } from '../runner-manager.js';
import type { ServicePaths } from '../storage.js';
import { AppBackends } from './backend-manager.js';
import type { ReadyInfo } from './backend-process.js';
import { CapabilityBroker } from './capabilities/broker.js';
import { AppConsents } from './consents.js';
import { AppDiagnostics } from './diagnostics.js';
import { AppPaths } from './paths.js';
import { toDetail, toSummary } from './records.js';
import { AppStore } from './store.js';
import { removeDrafts } from './versions.js';
import { WidgetPublisher } from './widgets/publisher.js';

export interface AppServiceDeps {
  paths: ServicePaths;
  ledger: Ledger;
  manager: RunnerManager;
  events: EventLog;
  log: Logger;
  mcp: () => Promise<McpAuthority>;
  /** Sends an invalidate frame to every stream client. */
  notify: (frame: InvalidateFrame) => void;
}

/**
 * The composition root of user apps for one service profile: the store, diagnostics, pending
 * consents, the backends and their capability broker, and the widget publisher. Routes
 * (routes.ts, runtime-routes.ts) and the agent's `app` tool (tool.ts) reach apps only through
 * it; the tool finds it by data directory (`AppService.for`), since harness extensions are built
 * per session from runner wiring that does not carry it.
 */
export class AppService {
  private static readonly instances = new Map<string, Promise<AppService>>();

  /** The profile's apps, once the server registered them; rejects when apps failed to load. */
  static for(dataDir: string): Promise<AppService> {
    return (
      AppService.instances.get(dataDir) ??
      Promise.reject(new Error('Apps are not available in this service.'))
    );
  }

  /** Loads the profile's apps once; later calls for the same data directory share the load. */
  static create(deps: AppServiceDeps): Promise<AppService> {
    const existing = AppService.instances.get(deps.paths.root);
    if (existing) return existing;
    const pending = AppService.load(deps);
    pending.catch(() => AppService.instances.delete(deps.paths.root));
    AppService.instances.set(deps.paths.root, pending);
    return pending;
  }

  private static async load(deps: AppServiceDeps): Promise<AppService> {
    const paths = new AppPaths(deps.paths.root);
    const store = await AppStore.load(paths, (message, appId) => deps.log.warn(message, { appId }));
    await removeLeftovers(paths, store);
    const service = new AppService(deps, paths, store);
    await service.widgets.load();
    return service;
  }

  readonly diagnostics: AppDiagnostics;
  readonly consents: AppConsents;
  readonly backends: AppBackends;
  readonly widgets: WidgetPublisher;

  private constructor(
    readonly deps: AppServiceDeps,
    readonly paths: AppPaths,
    readonly store: AppStore,
  ) {
    this.diagnostics = new AppDiagnostics(paths);
    store.onChanged(() => deps.notify({ type: 'invalidate', scope: 'apps' }));
    this.consents = new AppConsents(() => store.announce());
    const broker = new CapabilityBroker({
      paths: deps.paths,
      ledger: deps.ledger,
      manager: deps.manager,
      events: deps.events,
      store,
      consents: this.consents,
      mcp: deps.mcp,
      log: deps.log,
    });
    this.widgets = new WidgetPublisher({
      paths,
      store,
      diagnostics: this.diagnostics,
      log: deps.log,
      render: (appId, widgetId, family) => this.backends.render(appId, widgetId, family),
      changed: () => deps.notify({ type: 'invalidate', scope: 'widgets' }),
    });
    this.backends = new AppBackends({
      paths,
      store,
      diagnostics: this.diagnostics,
      log: deps.log,
      capability: (appId, request, reply, signal) => broker.handle(appId, request, reply, signal),
      widgetsReady: (appId, version, info) => void this.widgetsReady(appId, version, info),
      widgetReload: (appId, widgetId) => this.widgets.reload(appId, widgetId),
    });
  }

  detail(appId: string): AppDetail {
    return toDetail(this.store.get(appId), this.consents.list(appId));
  }

  list() {
    return {
      revision: this.store.revision,
      apps: this.store.list().map((app) => toSummary(app, this.consents.list(app.id))),
    };
  }

  async rename(appId: string, name: string | undefined): Promise<AppDetail> {
    if (name !== undefined)
      await this.store.change(appId, (draft) => {
        if (!draft) throw new Error('The app is gone.');
        return { ...draft, name, updatedAt: new Date().toISOString() };
      });
    return this.detail(appId);
  }

  /** Sets or forgets consents, then settles the requests waiting on the answered ones. */
  async setGrants(appId: string, patch: PatchAppGrantsRequest['grants']): Promise<AppDetail> {
    await this.store.change(appId, (draft) => {
      if (!draft) throw new Error('The app is gone.');
      const grants = { ...draft.grants };
      for (const capability of APP_CAPABILITIES) {
        const state = patch[capability];
        if (state === undefined) continue;
        if (state === null) delete grants[capability];
        else grants[capability] = state;
      }
      return { ...draft, grants, updatedAt: new Date().toISOString() };
    });
    const answers = this.store.get(appId).grants;
    this.consents.answer(appId, answers);
    return this.detail(appId);
  }

  /** What the shell's app window loads. */
  async runtime(appId: string): Promise<AppRuntime> {
    const app = this.store.get(appId);
    const webRoot = await realpath(path.join(this.paths.version(appId, app.currentVersion), 'web'));
    return {
      appId,
      name: app.name,
      version: app.currentVersion,
      webRoot,
      dataStoreId: app.dataStoreId,
      window: app.window,
    };
  }

  /**
   * Stops backends and timers for the stopping service; pending consents are denied. A service
   * started again on the same data directory in this process loads the apps anew.
   */
  async close(): Promise<void> {
    AppService.instances.delete(this.paths.dataDir);
    this.widgets.stop();
    for (const app of this.store.list()) this.consents.forget(app.id);
    await this.backends.stopAll();
  }

  /**
   * A backend of `version` reported ready: its widget declarations become the app's when that
   * is still the current version; the widget catalog changes with them.
   */
  private async widgetsReady(appId: string, version: number, info: ReadyInfo): Promise<void> {
    const app = this.store.find(appId);
    if (!app || app.currentVersion !== version) return;
    const same =
      app.widgetsVersion === version &&
      JSON.stringify(app.widgets) === JSON.stringify(info.widgets);
    if (!same) {
      await this.store
        .change(appId, (draft) => {
          if (!draft) throw new Error('The app is gone.');
          return { ...draft, widgets: info.widgets, widgetsVersion: version };
        })
        .catch((error: unknown) =>
          this.deps.log.warn('App widgets were not recorded.', { appId, error: String(error) }),
        );
      this.deps.notify({ type: 'invalidate', scope: 'widgets' });
    }
    this.widgets.ready(appId, version, info);
  }
}

/** Build scratch and version drafts a crash or a killed service left behind. */
async function removeLeftovers(paths: AppPaths, store: AppStore): Promise<void> {
  for (const name of await readdir(paths.workDir).catch(() => []))
    if (name.startsWith('build-') || name.startsWith('draft-'))
      await rm(path.join(paths.workDir, name), { recursive: true, force: true });
  for (const app of store.list()) await removeDrafts(paths, app.id);
}
