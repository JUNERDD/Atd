import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Compile } from 'typebox/compile';
import {
  errorMessage,
  WIDGET_LAUNCHER_MAX_APPS,
  WidgetInstancesRequestSchema,
  WidgetSnapshotSchema,
  widgetSnapshotKey,
  type WidgetCatalogApp,
  type WidgetFamily,
  type WidgetInstance,
  type WidgetLauncherApp,
  type WidgetSnapshot,
  type WidgetSync,
} from '@atd/agent-contracts';
import { atomicWrite } from '../../config.js';
import type { Logger } from '../../logging.js';
import type { ReadyInfo } from '../backend-process.js';
import type { AppDiagnostics } from '../diagnostics.js';
import type { AppPaths } from '../paths.js';
import type { AppStore } from '../store.js';
import { currentBuild } from '../versions.js';
import { widgetSnapshot } from './validate.js';

/** How often due refreshes are looked for. */
const SWEEP_MS = 60 * 1000;
/** Most (app, widget, family) renders kept current at once; the rest are skipped and logged. */
const MAX_TARGETS = 200;
const FAMILIES: readonly WidgetFamily[] = ['systemSmall', 'systemMedium', 'systemLarge'];
const SnapshotValidator = Compile(WidgetSnapshotSchema);
const InstancesValidator = Compile(WidgetInstancesRequestSchema);

export interface WidgetPublisherDeps {
  paths: AppPaths;
  store: AppStore;
  diagnostics: AppDiagnostics;
  log: Logger;
  /** Renders one widget family through the app's backend (starting it when needed). */
  render: (appId: string, widgetId: string, family: WidgetFamily) => Promise<unknown>;
  /** Sends the `widgets` invalidate; the shell then pulls `GET /v1/widgets/snapshots`. */
  changed: () => void;
}

interface Target {
  appId: string;
  widgetId: string;
  family: WidgetFamily;
  /** A reported instance shows it; otherwise it is only the gallery preview of its family. */
  placed: boolean;
}

/**
 * `AppWidgetPublisher` (plan "桌面小组件"): renders for the widget instances the system shows, as
 * the shell reports them (`POST /v1/widgets/instances`, persisted in `apps/widget-instances.json`;
 * see `targets` for what an instance renders, DECISIONS v10), and for the widget gallery's
 * preview, the newest declared widget of each family (plan T1c). A placed (app, widget, family)
 * renders when it is first reported, when its declared `refreshMinutes` passed since the last
 * render, when the backend asks (`widgetReload`), and when a new build's backend reports ready (a
 * new version, or an in-place build of the current one: a new revision). A preview renders the
 * same way except on a schedule: once per build, and again on `widgetReload`. A valid render
 * replaces the snapshot in `<appId>/widgets/`; an invalid one is dropped and written to the app's
 * diagnostics. The payload also carries the "My Apps" launcher's list, which needs no render:
 * every store change that alters it sends the invalidate as well.
 */
export class WidgetPublisher {
  private instances: WidgetInstance[] = [];
  private readonly snapshots = new Map<string, WidgetSnapshot>();
  /** The build revision each key was last rendered with, so a new build renders again. */
  private readonly renderedRevision = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<void>>();
  /** When each key last rendered, failed or not; schedules the next refresh. */
  private readonly attempted = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  /** The oversized render-set size last logged, so the warning is not repeated every sweep. */
  private warnedSize = 0;
  /** The launcher list the shell was last told about, serialized, so only real changes notify. */
  private launcherKey = '';
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: WidgetPublisherDeps) {}

  private get instancesFile(): string {
    return path.join(this.deps.paths.root, 'widget-instances.json');
  }

  /** Reads the saved instances and snapshots and starts the refresh sweep. */
  async load(): Promise<void> {
    try {
      const saved: unknown = JSON.parse(await readFile(this.instancesFile, 'utf8'));
      if (InstancesValidator.Check(saved)) this.instances = saved.instances;
    } catch {
      this.instances = [];
    }
    for (const app of this.deps.store.list()) {
      const dir = this.deps.paths.widgets(app.id);
      for (const name of await readdir(dir).catch(() => [])) {
        const match = /^([a-z][a-z0-9-]{0,31})\.(systemSmall|systemMedium|systemLarge)\.json$/.exec(
          name,
        );
        if (!match?.[1] || !match[2]) continue;
        const value: unknown = JSON.parse(
          await readFile(path.join(dir, name), 'utf8').catch(() => 'null'),
        );
        if (SnapshotValidator.Check(value))
          this.snapshots.set(`${app.id}/${match[1]}/${match[2]}`, value);
      }
    }
    this.timer = setInterval(() => this.sweep(), SWEEP_MS);
    this.timer.unref();
    this.launcherKey = JSON.stringify(this.launcher());
    this.unsubscribe = this.deps.store.onChanged(() => this.appsChanged());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Replaces the instance list and renders what is newly in the render set. */
  async setInstances(instances: WidgetInstance[]): Promise<void> {
    this.instances = instances;
    await mkdir(this.deps.paths.root, { recursive: true });
    await atomicWrite(this.instancesFile, { instances });
    this.sweep();
  }

  /**
   * The shell's sync payload: apps declaring widgets, the snapshots of those widgets, and the
   * launcher's apps.
   */
  sync(): WidgetSync {
    const catalog = this.catalog();
    const snapshots: Record<string, WidgetSnapshot> = {};
    for (const app of catalog)
      for (const widget of app.widgets)
        for (const family of widget.families) {
          const key = widgetSnapshotKey(app.appId, widget.id, family);
          const snapshot = this.snapshots.get(key);
          if (snapshot) snapshots[key] = snapshot;
        }
    return { catalog, snapshots, launcher: this.launcher() };
  }

  /** A backend reported ready: re-render this app's targets that another build rendered. */
  ready(appId: string, revision: number, _info: ReadyInfo): void {
    for (const target of this.targets(appId))
      if (this.renderedRevision.get(this.key(target)) !== revision) void this.render(target);
  }

  /** `ctx.widgets.reload(id)`: re-render that target of the app (every target of the app if absent). */
  reload(appId: string, widgetId: string | undefined): void {
    for (const target of this.targets(appId))
      if (!widgetId || target.widgetId === widgetId) void this.render(target);
  }

  /** Forgets a deleted app's snapshots (its directory is already gone). */
  forget(appId: string): void {
    for (const key of this.snapshots.keys())
      if (key.startsWith(`${appId}/`)) this.snapshots.delete(key);
    this.deps.changed();
  }

  /**
   * The "My Apps" launcher: every app, most recently updated first, as many as it shows. The icon
   * revision is the app's build revision, which names the build whose `icon.svg` the shell copies.
   */
  private launcher(): WidgetLauncherApp[] {
    return this.deps.store
      .list()
      .slice(0, WIDGET_LAUNCHER_MAX_APPS)
      .map((app) => ({
        appId: app.id,
        name: app.name,
        ...(app.accentColor ? { accentColor: app.accentColor } : {}),
        iconRevision: app.revision,
        ...(app.description ? { description: app.description } : {}),
      }));
  }

  /**
   * A store change: creating, publishing, renaming, reverting, deleting or updating an app can
   * change what the launcher lists or its order, which only the shell's next pull delivers.
   * Changes that leave the list as it was (consents, widget declarations) send nothing here.
   */
  private appsChanged(): void {
    const key = JSON.stringify(this.launcher());
    if (key === this.launcherKey) return;
    this.launcherKey = key;
    this.deps.changed();
  }

  /**
   * Apps that declare widgets, most recently updated first (the store's order), with the
   * declarations their backend last reported. A new build keeps its predecessor's listed until its
   * own backend reports, so placed widgets and desktop pins keep their snapshots through a rebuild
   * instead of dropping out of the catalog in between.
   */
  private catalog(): WidgetCatalogApp[] {
    return this.deps.store
      .list()
      .filter((app) => app.widgetsRevision !== null && app.widgets.length > 0)
      .slice(0, 256)
      .map((app) => ({
        appId: app.id,
        name: app.name,
        ...(app.accentColor ? { accentColor: app.accentColor } : {}),
        widgets: app.widgets,
      }));
  }

  /**
   * The render set. First the gallery previews: per family, the first widget of the newest app
   * declaring it, the one the extension's gallery entry shows. Then the union over reported
   * instances, deduplicated by (app, widget, family): an instance naming its app widget renders
   * that one; an instance without one (the shell cannot read which app widget a WidgetKit
   * instance shows) renders every declared widget of that family, of the named app or of every
   * app. Bounded by `MAX_TARGETS`, which always keeps the at most three previews.
   */
  private targets(appId?: string): Target[] {
    const catalog = this.catalog();
    const seen = new Map<string, Target>();
    const add = (target: Target) => {
      if (!seen.get(this.key(target))?.placed) seen.set(this.key(target), target);
    };
    for (const family of FAMILIES) {
      const app = catalog.find((item) => item.widgets.some((w) => w.families.includes(family)));
      const widget = app?.widgets.find((item) => item.families.includes(family));
      if (app && widget) add({ appId: app.appId, widgetId: widget.id, family, placed: false });
    }
    for (const instance of this.instances) {
      for (const app of catalog) {
        if (instance.appId && app.appId !== instance.appId) continue;
        for (const widget of app.widgets) {
          if (instance.widgetId && widget.id !== instance.widgetId) continue;
          if (widget.families.includes(instance.family))
            add({ appId: app.appId, widgetId: widget.id, family: instance.family, placed: true });
        }
      }
    }
    const all = [...seen.values()];
    if (all.length > MAX_TARGETS && this.warnedSize !== all.length) {
      this.warnedSize = all.length;
      this.deps.log.warn('Too many app widgets to render; the rest are skipped.', {
        widgets: all.length,
        rendered: MAX_TARGETS,
      });
    }
    return all.slice(0, MAX_TARGETS).filter((target) => !appId || target.appId === appId);
  }

  /** Renders placed targets without a snapshot or due for refresh, and previews not yet rendered. */
  private sweep(): void {
    const now = Date.now();
    for (const target of this.targets())
      if (target.placed ? this.due(target, now) : this.unrendered(target)) void this.render(target);
  }

  /** A placed target has no snapshot, or its declared refresh interval passed since the last try. */
  private due(target: Target, now: number): boolean {
    const decl = this.deps.store
      .find(target.appId)
      ?.widgets.find((widget) => widget.id === target.widgetId);
    const generatedAt = this.snapshots.get(this.key(target))?.generatedAt;
    const last = this.attempted.get(this.key(target)) ?? (generatedAt && Date.parse(generatedAt));
    return !last || now - last >= (decl?.refreshMinutes ?? 60) * 60_000;
  }

  /**
   * A preview has no snapshot and was not tried with the app's current build, so a failing
   * render waits for the next build or `widgetReload` instead of retrying every sweep.
   */
  private unrendered(target: Target): boolean {
    const key = this.key(target);
    const revision = this.deps.store.find(target.appId)?.revision;
    return !this.snapshots.has(key) && this.renderedRevision.get(key) !== revision;
  }

  private key(target: Pick<Target, 'appId' | 'widgetId' | 'family'>): string {
    return widgetSnapshotKey(target.appId, target.widgetId, target.family);
  }

  private render(target: Target): Promise<void> {
    const key = this.key(target);
    const running = this.inflight.get(key);
    if (running) return running;
    const work = this.renderNow(target, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, work);
    return work;
  }

  private async renderNow(target: Target, key: string): Promise<void> {
    const app = this.deps.store.find(target.appId);
    if (!app) return;
    const { currentVersion: version, revision } = app;
    this.attempted.set(key, Date.now());
    try {
      const value = await this.deps.render(target.appId, target.widgetId, target.family);
      const web = path.join(await currentBuild(this.deps.paths, app), 'web');
      const snapshot = await widgetSnapshot(value, web);
      const dir = this.deps.paths.widgets(target.appId);
      await mkdir(dir, { recursive: true });
      await atomicWrite(path.join(dir, `${target.widgetId}.${target.family}.json`), snapshot);
      this.snapshots.set(key, snapshot);
      this.renderedRevision.set(key, revision);
      this.deps.changed();
    } catch (error) {
      // The previous snapshot stays; a failing render waits for the next refresh, reload or build.
      this.renderedRevision.set(key, revision);
      await this.deps.diagnostics.append(target.appId, [
        {
          source: 'widget',
          level: 'error',
          version,
          message: `Widget ${target.widgetId} (${target.family}) was not updated: ${errorMessage(error)}`,
        },
      ]);
    }
  }
}
