import { randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AppManifestSchema,
  errorMessage,
  parse,
  type AppBuildDetails,
  type AppDetail,
} from '@atd/agent-contracts';
import { ensureSkillProfile, skillProfilePaths } from '../skills/profile.js';
import { stageTaskSkills } from '../skills/staging.js';
import { publishFromTask, type PublishRequest } from './publish.js';
import { runtimeWindow } from './records.js';
import type { AppService } from './service.js';
import { copyVersionDraft, currentBuild, installVersion } from './versions.js';

/** Builds of one task run one at a time; two would race for the same version and revision. */
const building = new Map<string, Promise<unknown>>();

export interface BuildOutcome {
  details: AppBuildDetails;
  /**
   * What the agent reads: the version, whether this build updated it in place, type errors,
   * notes and whether the backend started.
   */
  report: Record<string, unknown>;
}

/**
 * `app.build`: publishes the task's source (the run's first build as the next version, a later
 * one in place of it), then restarts the backend on that build and starts it once, which checks
 * that it starts and reports its widgets for the card.
 */
export function buildFromTask(service: AppService, request: PublishRequest): Promise<BuildOutcome> {
  const key = `${service.paths.dataDir}\n${request.taskId}`;
  const previous = building.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => build(service, request));
  building.set(key, run);
  void run
    .finally(() => {
      if (building.get(key) === run) building.delete(key);
    })
    .catch(() => undefined);
  return run;
}

async function build(service: AppService, request: PublishRequest): Promise<BuildOutcome> {
  const published = await publishFromTask(service, request);
  const { app, version, typecheck, updated } = published;
  await service.backends.stop(app.id);
  let widgets = 0;
  let backend = 'none';
  const hasServer = await stat(path.join(await currentBuild(service.paths, app), 'server'))
    .then((info) => info.isDirectory())
    .catch(() => false);
  if (hasServer) {
    try {
      await service.backends.ensure(app.id);
      backend = 'started';
      widgets = service.store.get(app.id).widgets.length;
    } catch (error) {
      backend = `failed to start: ${errorMessage(error)} (see app diagnostics)`;
    }
  }
  return {
    details: {
      type: 'app',
      appId: app.id,
      name: app.name,
      version: version.n,
      revision: version.revision,
      updated,
      summary: version.summary,
      typecheck: version.typecheck,
      widgets,
    },
    report: {
      appId: app.id,
      name: app.name,
      version: version.n,
      created: published.created,
      // In place: this run's earlier build published `version`; this one replaced its files.
      updated,
      backend,
      widgets,
      typecheck: {
        ok: typecheck.ok,
        errorCount: typecheck.errorCount,
        errors: typecheck.diagnostics
          .slice(0, 30)
          .map((item) => `${item.file}:${item.line}:${item.column} ${item.code} ${item.message}`),
      },
      ...(published.notes.length ? { notes: published.notes } : {}),
    },
  };
}

/**
 * Publishes a copy of `n` as the next version, with that version's manifest. Its draft is removed
 * when the publish failed (a published one was renamed away).
 */
export async function revertApp(service: AppService, appId: string, n: number): Promise<AppDetail> {
  service.store.get(appId);
  const { draft, old } = await copyVersionDraft(service.paths, appId, n);
  try {
    const manifest = parse(
      AppManifestSchema,
      JSON.parse(await readFile(path.join(draft, 'source', 'atd-app.json'), 'utf8')),
    );
    await service.store.change(appId, async (record) => {
      if (!record) throw new Error('The app is gone.');
      const version = await installVersion(
        service.paths,
        appId,
        draft,
        { summary: `Reverted to version ${n}.`, typecheck: old.typecheck },
        {
          current: { version: record.currentVersion, revision: record.revision },
          replace: null,
        },
      );
      const { purposes: _purposes, accentColor: _accentColor, ...rest } = record;
      return {
        ...rest,
        name: manifest.name,
        description: manifest.description,
        ...(manifest.accentColor ? { accentColor: manifest.accentColor } : {}),
        window: runtimeWindow(manifest),
        capabilities: manifest.capabilities,
        ...(manifest.purposes ? { purposes: manifest.purposes } : {}),
        currentVersion: version.n,
        revision: version.revision,
        updatedAt: new Date().toISOString(),
      };
    });
  } finally {
    await rm(draft, { recursive: true, force: true });
  }
  await service.backends.stop(appId);
  return service.detail(appId);
}

/** Stops the backend, then removes the app with every version, its data and its widgets. */
export async function deleteApp(service: AppService, appId: string): Promise<void> {
  service.store.get(appId);
  await service.backends.forget(appId);
  service.consents.forget(appId);
  await service.store.remove(appId);
  service.widgets.forget(appId);
}

/** Stops the backend and empties the app's data directory (the directory itself stays). */
export async function clearAppData(service: AppService, appId: string): Promise<AppDetail> {
  service.store.get(appId);
  await service.backends.stop(appId);
  const dir = service.paths.data(appId);
  await mkdir(dir, { recursive: true });
  for (const entry of await readdir(dir))
    await rm(path.join(dir, entry), { recursive: true, force: true });
  return service.detail(appId);
}

/**
 * The task to continue editing in: the app's source task while it exists. Otherwise a new task
 * starts with the latest version's source restored into its `app/`, the create-app skill staged
 * for its first run and a prompt that names the app; the app moves to that task, so its builds
 * publish new versions of this app.
 */
export async function editApp(service: AppService, appId: string): Promise<{ taskId: string }> {
  const app = service.store.get(appId);
  const { ledger, manager, paths } = service.deps;
  if (ledger.data.tasks.some((task) => task.id === app.sourceTaskId))
    return { taskId: app.sourceTaskId };
  const taskId = randomUUID();
  const target = path.join(service.paths.taskOutput(taskId), 'app');
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(await currentBuild(service.paths, app), 'source'), target, {
    recursive: true,
  });
  const profile = skillProfilePaths(paths.root, paths.agentDir);
  await ensureSkillProfile(profile);
  await stageTaskSkills(profile, taskId, [{ name: 'create-app' }]);
  const moveTo = (sourceTaskId: string) =>
    service.store.change(appId, (record) => {
      if (!record) throw new Error('The app is gone.');
      return { ...record, sourceTaskId, updatedAt: new Date().toISOString() };
    });
  // Moved before the run exists, so its first build already finds this app.
  await moveTo(taskId);
  const submitted = manager.submit({
    operationId: randomUUID(),
    taskId,
    input: {
      text: `Continue working on my app "${app.name}". Its latest source (version ${app.currentVersion}) is restored in app/. Look it over briefly, then ask me what to change.`,
      source: 'manual',
      capturedAt: new Date().toISOString(),
      selection: '',
      clipboard: '',
      files: [],
      arguments: {},
      chips: [],
      folders: [],
    },
  });
  await submitted.catch(async (error: unknown) => {
    await moveTo(app.sourceTaskId);
    await rm(path.dirname(service.paths.taskOutput(taskId)), { recursive: true, force: true });
    throw error;
  });
  return { taskId };
}
