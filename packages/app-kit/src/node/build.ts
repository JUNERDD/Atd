import fs from 'node:fs/promises';
import path from 'node:path';
import { builderProfile, SANDBOX_EXEC, writeProfile } from './seatbelt.js';
import { runSandboxed } from './spawn.js';
import type { DependencyTree } from './deps/store.js';
import type { StagedApp } from './staging.js';
import type { AppSurface } from '@atd/agent-contracts';
import { manifestAccentColor, manifestSurface, pageStyles, THEME_DIR } from './theme.js';
import {
  loadToolchain,
  nodeBinary,
  PROVIDED_PACKAGES,
  realpath,
  SERVER_PACKAGES,
  WEB_PACKAGES,
} from './toolchain.js';

/** Step 4 of an app build: the sandboxed Vite build of a staged app. */

export const BUILD_TIMEOUT_MS = 120_000;

export type BuildErrorCode =
  /** A bare import outside the allow-list, a URL import, or a built-in on the page. */
  | 'import_not_allowed'
  /** A relative or absolute import that leaves the app. */
  | 'outside_app'
  /** Package CSS with a Tailwind directive (the dependency tree audit refuses it first). */
  | 'dependency_css_directive'
  /** A module the load fence refused (outside the app and the toolchain). */
  | 'load_outside'
  /** An app CSS `@import` of something other than app files, `@atd/ui` or `tailwindcss`. */
  | 'css_import'
  /**
   * `atd-app.json` is not JSON, its `accentColor` is not `#RRGGBB`, or its `window.surface` is
   * neither `glass` nor `opaque`.
   */
  | 'invalid_manifest'
  /** Anything else Vite reported (syntax errors, missing files…). */
  | 'build_failed'
  | 'timeout'
  /** The builder process died without reporting (sandbox refusal, crash, out of memory). */
  | 'builder_crashed'
  | 'missing_output';

export interface BuildError {
  code: BuildErrorCode;
  message: string;
  /** The app file the error is about, relative to the app root, when known. */
  file?: string;
}

export interface BuildAppOptions {
  app: StagedApp;
  /** Receives `web/` and, for an app with a backend, `server/index.mjs`; missing or empty. */
  outDir: string;
  /** Scratch directory for the generated sandbox profile. */
  workDir: string;
  /** The Node binary to run the builder with; defaults to the service's own. */
  nodePath?: string;
  timeoutMs?: number;
  /**
   * The app's dependency tree (`prepareDependencies`): app code may import the declared names,
   * which resolve from it. Absent or null for an app that declares none, which builds as before.
   */
  deps?: Pick<DependencyTree, 'root' | 'names'> | null;
}

/** The tree packages each bundle took modules from, by name (built with `deps` only). */
export interface DependenciesUsed {
  web: string[];
  server: string[];
}

export type BuildResult =
  | {
      ok: true;
      durationMs: number;
      hasServer: boolean;
      log: string;
      depsUsed?: DependenciesUsed;
    }
  | { ok: false; durationMs: number; errors: BuildError[]; log: string };

/**
 * Vite 8 probes every ancestor of its root for `package.json`/`pnpm-workspace.yaml` while looking
 * for the workspace root; under `--permission` the first probe outside the granted paths throws.
 * It stops at the first directory holding a marker, so the service writes both into each Vite
 * root (staging refuses agent files with these names).
 */
async function writeRootMarkers(app: StagedApp) {
  for (const dir of [app.dir, path.join(app.dir, 'web')]) {
    await fs.writeFile(path.join(dir, 'package.json'), '{ "private": true }\n');
    await fs.writeFile(path.join(dir, 'pnpm-workspace.yaml'), '');
  }
}

/** The codes the builder itself reports; the others are assigned here. */
const REPORTED_CODES: readonly string[] = [
  'import_not_allowed',
  'outside_app',
  'load_outside',
  'css_import',
  'dependency_css_directive',
  'build_failed',
] satisfies BuildErrorCode[];
const isReportedCode = (code: unknown): code is BuildErrorCode =>
  typeof code === 'string' && REPORTED_CODES.includes(code);

/** The `depsUsed` of a `buildResult` message, when it has one. */
function readUsed(message: object): DependenciesUsed | undefined {
  const used: unknown = Reflect.get(message, 'depsUsed');
  if (used === null || typeof used !== 'object') return undefined;
  const names = (side: string): string[] => {
    const list: unknown = Reflect.get(used, side);
    return Array.isArray(list) ? list.filter((name) => typeof name === 'string') : [];
  };
  return { web: names('web'), server: names('server') };
}

/** The builder's `buildResult` message, checked field by field (it comes from the sandbox). */
function readReport(
  messages: unknown[],
):
  | { ok: true; depsUsed: DependenciesUsed | undefined }
  | { ok: false; errors: BuildError[] }
  | null {
  for (const message of messages) {
    if (message === null || typeof message !== 'object') continue;
    if (Reflect.get(message, 't') !== 'buildResult') continue;
    if (Reflect.get(message, 'ok') === true) return { ok: true, depsUsed: readUsed(message) };
    const raw: unknown = Reflect.get(message, 'errors');
    const errors: BuildError[] = (Array.isArray(raw) ? raw : []).flatMap((entry: unknown) => {
      if (entry === null || typeof entry !== 'object') return [];
      const code: unknown = Reflect.get(entry, 'code');
      const text: unknown = Reflect.get(entry, 'message');
      const file: unknown = Reflect.get(entry, 'file');
      if (!isReportedCode(code) || typeof text !== 'string') return [];
      const error: BuildError = { code, message: text.slice(0, 8000) };
      return [typeof file === 'string' ? { ...error, file } : error];
    });
    return { ok: false, errors };
  }
  return null;
}

/**
 * Builds a staged app inside the builder sandbox: Seatbelt (no network, writes only to `outDir`,
 * reads under `/Users` only the app, the toolchain and Node) around `node --permission
 * --allow-addons` with one `--allow-fs-read` per path (Node 24 grants nothing for a comma list).
 * The environment is built from scratch; the build is killed after `timeoutMs` (120 s). The
 * manifest's `accentColor` and `window.surface` theme the page's `@atd/ui` styles (`theme.ts`).
 * A dependency tree joins the reads and the load fence, and the module policy resolves the
 * declared names from it.
 */
export async function buildApp(options: BuildAppOptions): Promise<BuildResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const toolchain = loadToolchain();
  const node = nodeBinary(options.nodePath);
  await fs.mkdir(options.outDir, { recursive: true });
  if ((await fs.readdir(options.outDir)).length > 0)
    throw new Error(`${options.outDir} must be empty.`);
  const outDir = realpath(options.outDir);
  const stagingDir = options.app.dir;
  let accentColor: string | null;
  let surface: AppSurface;
  try {
    accentColor = await manifestAccentColor(stagingDir);
    surface = await manifestSurface(stagingDir);
  } catch (error) {
    const message = `atd-app.json: ${error instanceof Error ? error.message : String(error)}`;
    const errors: BuildError[] = [{ code: 'invalid_manifest', message, file: 'atd-app.json' }];
    return { ok: false, durationMs: elapsed(), errors, log: '' };
  }
  await writeRootMarkers(options.app);
  const styles = await pageStyles(outDir, toolchain.cssAliases, accentColor, surface);
  const deps = options.deps ?? null;
  const readRoots = deps ? [...toolchain.readRoots, deps.root] : toolchain.readRoots;

  const profile = writeProfile(
    options.workDir,
    'builder.sb',
    builderProfile({ stagingDir, outDir, readRoots, node }),
  );
  const config = {
    stagingDir,
    outDir,
    hasServer: options.app.hasServer,
    webPackages: WEB_PACKAGES,
    serverPackages: SERVER_PACKAGES,
    fence: [...readRoots, ...styles.generated],
    cssAliases: styles.cssAliases,
    sdk: toolchain.sdk,
    toolchainPackageJson: toolchain.packageJson,
    deps: deps && {
      root: deps.root,
      packageJson: path.join(deps.root, 'package.json'),
      names: deps.names,
    },
    provided: PROVIDED_PACKAGES,
  };
  const reads = [stagingDir, outDir, ...readRoots];
  const run = await runSandboxed({
    command: SANDBOX_EXEC,
    args: [
      '-f',
      profile,
      node.path,
      '--permission',
      '--allow-addons',
      ...reads.map((dir) => `--allow-fs-read=${dir}`),
      `--allow-fs-write=${outDir}`,
      toolchain.builderScript,
      JSON.stringify(config),
    ],
    env: { LANG: 'en_US.UTF-8', NODE_ENV: 'production' },
    cwd: stagingDir,
    timeoutMs: options.timeoutMs ?? BUILD_TIMEOUT_MS,
    ipc: true,
  });
  for (const scratch of ['.vite-cache', THEME_DIR])
    await fs.rm(path.join(outDir, scratch), { recursive: true, force: true });
  const log = `${run.stdout}${run.stderr}`.slice(-64 * 1024);
  const fail = (errors: BuildError[]): BuildResult => ({
    ok: false,
    durationMs: elapsed(),
    errors,
    log,
  });

  if (run.timedOut)
    return fail([{ code: 'timeout', message: 'The build took longer than allowed.' }]);
  const report = readReport(run.messages);
  if (!report) {
    const reason = run.signal ? `signal ${run.signal}` : `exit code ${run.code}`;
    return fail([
      {
        code: 'builder_crashed',
        message: `The builder stopped (${reason}). ${run.stderr.slice(-2000)}`,
      },
    ]);
  }
  if (!report.ok) {
    return fail(
      report.errors.length > 0
        ? report.errors
        : [{ code: 'build_failed', message: 'The build failed.' }],
    );
  }
  const expected = ['web/index.html', ...(options.app.hasServer ? ['server/index.mjs'] : [])];
  for (const file of expected) {
    const stat = await fs.stat(path.join(outDir, file)).catch(() => null);
    if (!stat?.isFile())
      return fail([{ code: 'missing_output', message: `The build produced no ${file}.` }]);
  }
  const done = { ok: true as const, durationMs: elapsed(), hasServer: options.app.hasServer, log };
  return report.depsUsed ? { ...done, depsUsed: report.depsUsed } : done;
}
