import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  buildApp,
  prepareStaging,
  typecheckApp,
  type BuildError,
  type StagedApp,
  type TypecheckResult,
} from '@atd/app-kit/node';
import {
  APP_ICON_MAX_BYTES,
  APP_SUMMARY_MAX_LENGTH,
  AppManifestSchema,
  errorMessage,
  parse,
  type AppManifest,
  type AppTypecheck,
  type AppVersion,
} from '@atd/agent-contracts';
import type { AppDiagnostics, DiagnosticInput } from './diagnostics.js';
import { buildFailed } from './errors.js';
import type { AppPaths } from './paths.js';
import { runtimeWindow, type AppRecord } from './records.js';
import { newAppId, newDataStoreId, type AppStore } from './store.js';
import { installVersion, runVersion, versionDraft } from './versions.js';

/** Typecheck errors written to diagnostics per build (the result lists up to 200). */
const TYPECHECK_DIAGNOSTICS = 50;
/** Marker files the builder writes into the staging roots; never part of the source snapshot. */
const BUILD_MARKERS = ['package.json', 'pnpm-workspace.yaml'];

export interface PublishRequest {
  taskId: string;
  runId?: string;
  /** The source directory, relative to the task output (`app` by default). */
  dir: string;
  summary: string;
}

export interface PublishResult {
  app: AppRecord;
  version: AppVersion;
  created: boolean;
  /** The build replaced the files of the version an earlier build of its run published. */
  updated: boolean;
  typecheck: TypecheckResult;
  /** Non-fatal notes for the agent (an icon left out, a typecheck that did not run). */
  notes: string[];
}

export interface PublishDeps {
  paths: AppPaths;
  store: AppStore;
  diagnostics: AppDiagnostics;
}

/**
 * The `app.build` pipeline (plan "构建与发布"): stage the task's source (app-kit refuses
 * anything that could steer the toolchain), validate `atd-app.json`, then typecheck and build in
 * parallel, each in its own sandbox, in a scratch directory under `apps/.work`. A refused or
 * failed build publishes nothing and throws `app_build_failed` with every error. A build that
 * succeeded publishes the built `web/` and `server/`, the source snapshot and the icon as the
 * app's next build revision: the run's first build as the next version, its later builds in
 * place of that version (versions.ts). The first build of a task creates its app. Type errors
 * never block.
 */
export async function publishFromTask(
  deps: PublishDeps,
  request: PublishRequest,
): Promise<PublishResult> {
  const output = deps.paths.taskOutput(request.taskId);
  const source = path.resolve(output, request.dir);
  if (path.isAbsolute(request.dir) || !source.startsWith(output + path.sep))
    throw buildFailed(`"${request.dir}" must be a folder inside the task folder.`);
  const existing = deps.store.bySourceTask(request.taskId);
  const work = path.join(deps.paths.workDir, `build-${randomUUID()}`);
  await mkdir(work, { recursive: true });
  try {
    const staged = await prepareStaging(source, path.join(work, 'staging'));
    if (!staged.ok)
      return await refuse(
        deps,
        existing,
        staged.errors.map((error) => error.message),
      );
    const manifest = await readManifest(staged.app).catch((error: unknown) =>
      refuse(deps, existing, [`atd-app.json: ${errorMessage(error)}`]),
    );
    const out = path.join(work, 'out');
    const [typecheck, built] = await Promise.all([
      typecheckApp({ app: staged.app, workDir: path.join(work, 'typecheck') }),
      buildApp({ app: staged.app, outDir: out, workDir: path.join(work, 'build') }),
    ]);
    if (!built.ok) return await refuse(deps, existing, built.errors.map(buildErrorText), built.log);
    const notes: string[] = [];
    if (typecheck.failure)
      notes.push(`The type check did not run to completion: ${typecheck.failure}`);
    const draft = await assemble(deps.paths, existing?.id, staged.app, out, notes);
    return await record(deps, request, {
      existing,
      manifest,
      typecheck,
      notes,
      draft,
      hasServer: staged.app.hasServer,
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function readManifest(app: StagedApp): Promise<AppManifest> {
  const text = await readFile(path.join(app.dir, 'atd-app.json'), 'utf8');
  return parse(AppManifestSchema, JSON.parse(text));
}

function buildErrorText(error: BuildError): string {
  return `${error.file ? `${error.file}: ` : ''}${error.message} (${error.code})`;
}

/** Records a refused build in the app's diagnostics (when it has an app) and throws. */
async function refuse(
  deps: PublishDeps,
  existing: AppRecord | undefined,
  errors: string[],
  log?: string,
): Promise<never> {
  if (existing) {
    const entries: DiagnosticInput[] = errors.slice(0, 20).map((message) => ({
      source: 'build',
      level: 'error',
      version: null,
      message,
      ...(log ? { detail: log.slice(-16000) } : {}),
    }));
    await deps.diagnostics.append(existing.id, entries);
  }
  throw buildFailed(`The build published nothing:\n- ${errors.join('\n- ')}`);
}

/**
 * Lays out a version draft: built `web/` (and `server/`), the source snapshot without the
 * builder's marker files, and the icon. A first build has no app id yet, so its draft waits in
 * the scratch area and moves when the app is created.
 */
async function assemble(
  paths: AppPaths,
  appId: string | undefined,
  app: StagedApp,
  out: string,
  notes: string[],
): Promise<string> {
  const draft = appId
    ? await versionDraft(paths, appId)
    : path.join(paths.workDir, `draft-${randomUUID()}`);
  await mkdir(draft, { recursive: true });
  await rename(path.join(out, 'web'), path.join(draft, 'web'));
  if (app.hasServer) await rename(path.join(out, 'server'), path.join(draft, 'server'));
  await cp(app.dir, path.join(draft, 'source'), {
    recursive: true,
    filter: (file) => {
      const relative = path.relative(app.dir, file);
      return !BUILD_MARKERS.some((marker) => relative === marker || relative === `web/${marker}`);
    },
  });
  const icon = path.join(app.dir, 'icon.svg');
  const size = (await stat(icon).catch(() => null))?.size;
  if (size === undefined) notes.push('The app has no icon.svg; it shows a default icon.');
  else if (size > APP_ICON_MAX_BYTES)
    notes.push('icon.svg is larger than 256 KiB and was left out.');
  else await cp(icon, path.join(draft, 'icon.svg'));
  return draft;
}

interface Built {
  existing: AppRecord | undefined;
  manifest: AppManifest;
  typecheck: TypecheckResult;
  notes: string[];
  draft: string;
  /** The build has a backend, the only thing that reports widget declarations. */
  hasServer: boolean;
}

/**
 * Publishes the draft in the store change that records it: in place of the current version when
 * this run published that one (`runVersion`), otherwise as the next version.
 */
async function record(deps: PublishDeps, request: PublishRequest, built: Built) {
  const { manifest, typecheck } = built;
  const appId = built.existing?.id ?? newAppId();
  const summary: AppTypecheck = { ok: typecheck.ok, errorCount: typecheck.errorCount };
  let version: AppVersion | undefined;
  let updated = false;
  try {
    const app = await deps.store.change(appId, async (draft) => {
      const now = new Date().toISOString();
      let source = built.draft;
      if (!draft) {
        // A new app: its versions directory exists only now.
        source = await versionDraft(deps.paths, appId);
        await rm(source, { recursive: true });
        await rename(built.draft, source);
      }
      const replace = draft
        ? await runVersion(deps.paths, appId, draft.currentVersion, request.runId)
        : null;
      version = await installVersion(
        deps.paths,
        appId,
        source,
        {
          ...(request.runId ? { runId: request.runId } : {}),
          summary: request.summary.slice(0, APP_SUMMARY_MAX_LENGTH),
          typecheck: summary,
        },
        {
          current: { version: draft?.currentVersion ?? 0, revision: draft?.revision ?? 0 },
          replace,
        },
      );
      updated = replace !== null;
      return {
        id: appId,
        name: manifest.name,
        description: manifest.description,
        ...(manifest.accentColor ? { accentColor: manifest.accentColor } : {}),
        sourceTaskId: draft?.sourceTaskId ?? request.taskId,
        currentVersion: version.n,
        revision: version.revision,
        dataStoreId: draft?.dataStoreId ?? newDataStoreId(),
        window: runtimeWindow(manifest),
        capabilities: manifest.capabilities,
        ...(manifest.purposes ? { purposes: manifest.purposes } : {}),
        grants: draft?.grants ?? {},
        // The last reported declarations stay until this build's backend reports its own, so the
        // widget catalog keeps the app through a rebuild; a build without a backend never reports.
        widgets: built.hasServer ? (draft?.widgets ?? []) : [],
        widgetsRevision: built.hasServer ? (draft?.widgetsRevision ?? null) : null,
        createdAt: draft?.createdAt ?? now,
        updatedAt: now,
      };
    });
    if (!version) throw new Error('The version was not recorded.');
    await deps.diagnostics.append(appId, typecheckDiagnostics(typecheck, version.n));
    return { app, version, created: !built.existing, updated, typecheck, notes: built.notes };
  } catch (error) {
    await rm(built.draft, { recursive: true, force: true });
    throw error;
  }
}

function typecheckDiagnostics(result: TypecheckResult, version: number): DiagnosticInput[] {
  const entries: DiagnosticInput[] = result.diagnostics
    .slice(0, TYPECHECK_DIAGNOSTICS)
    .map((item) => ({
      source: 'typecheck',
      level: 'error',
      version,
      message: `${item.file}:${item.line}:${item.column} ${item.code} ${item.message}`,
    }));
  if (result.failure)
    entries.push({ source: 'typecheck', level: 'warning', version, message: result.failure });
  return entries;
}
