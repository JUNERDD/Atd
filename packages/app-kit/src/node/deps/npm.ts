import fs from 'node:fs/promises';
import path from 'node:path';
import { installerProfile, SANDBOX_EXEC, writeProfile } from '../seatbelt.js';
import { runSandboxed } from '../spawn.js';
import { loadToolchain, nodeBinary, realpath } from '../toolchain.js';
import type { DependencyError } from './errors.js';

/**
 * npm (app-kit's pinned copy, run by the service's Node) inside the installer sandbox: Seatbelt
 * (`installerProfile`) around `node --permission`, which grants reads of npm, its directories and
 * the npmrc files and writes to its working directory, cache and temporary directory, and nothing
 * else (no child processes, workers or addons: scripts never run). Its whole configuration comes
 * from the flags below: the environment is built from scratch (no tokens, proxies, `npm_config_*`
 * or `NODE_OPTIONS`), the user and global npmrc files are empty, and npm never finds a project
 * `.npmrc` because every directory it runs in is service-made.
 */

/** The registry every install uses; there is no mirror or proxy setting yet. */
export const NPM_REGISTRY = 'https://registry.npmjs.org/';
/** Resolution only picks releases at least this many days old (pinned peers excepted). */
export const MIN_RELEASE_AGE_DAYS = 3;
export const RESOLVE_TIMEOUT_MS = 120_000;
export const INSTALL_TIMEOUT_MS = 180_000;

/** npm's state for one dependency cache; realpaths. */
export interface NpmDirs {
  /** npm's cacache (packuments and tarballs), shared by every install of the cache. */
  cache: string;
  /** Holds the empty `user-npmrc` and `global-npmrc`. */
  config: string;
}

export interface NpmCommand {
  /** The command and its own flags; the fixed flags follow. */
  args: string[];
  /** npm's working directory (a realpath), holding the `package.json`. */
  cwd: string;
  dirs: NpmDirs;
  /** Scratch for the profile and npm's `HOME` and `TMPDIR` (a realpath). */
  scratch: string;
  timeoutMs: number;
  /** What a timeout message says took too long: `Resolving` or `Installing`. */
  activity: string;
  registry: string;
  nodePath?: string;
}

export interface NpmFailure {
  /** npm's error code (`E404`, `ENOTCACHED`…), or `timeout` / `crashed` for the run itself. */
  npmCode: string;
  error: DependencyError;
}

export type NpmResult = { ok: true; stdout: string } | { ok: false; failure: NpmFailure };

/**
 * Creates `npm/` and `config/` under `root` with empty npmrc files (two files: npm refuses one
 * file as both, X2 E1). The files are rewritten on every call, so nothing else configures npm.
 */
export async function npmDirs(root: string): Promise<NpmDirs> {
  const cache = path.join(root, 'npm');
  const config = path.join(root, 'config');
  for (const dir of [cache, config]) await fs.mkdir(dir, { recursive: true });
  for (const file of ['user-npmrc', 'global-npmrc'])
    await fs.writeFile(path.join(config, file), '', { mode: 0o600 });
  return { cache: realpath(cache), config: realpath(config) };
}

function npmFlags(dirs: NpmDirs, registry: string): string[] {
  return [
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-update-notifier',
    '--allow-git=none',
    '--allow-remote=none',
    '--allow-file=none',
    '--allow-directory=none',
    `--registry=${registry}`,
    `--userconfig=${path.join(dirs.config, 'user-npmrc')}`,
    `--globalconfig=${path.join(dirs.config, 'global-npmrc')}`,
    `--cache=${dirs.cache}`,
    '--logs-max=0',
    '--omit=optional',
    '--fetch-timeout=60000',
    '--fetch-retries=1',
    '--json',
  ];
}

/**
 * Codes of a request that never reached the registry (an offline machine, DNS, the sandbox), and
 * ENOTCACHED: an offline install missing a package. A request npm could not make at all is also
 * reported as `request to <url> failed` or `network timeout at <url>`, whatever its code (EPERM
 * when Seatbelt refuses the connection), while registry answers such as E404 or E503 are not.
 */
const OFFLINE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENOTCACHED',
]);
const UNSENT_REQUEST = /request to https?:\/\/\S+ failed|network timeout at/;
const OFFLINE_MESSAGE =
  "The npm registry could not be reached, so the packages could not be downloaded. Builds work offline while the app's dependencies stay as they are.";

/** npm's `{ error: { code, summary, detail } }` on stdout (`--json`), or null. */
function reportedError(stdout: string): { code: string; summary: string; detail: string } | null {
  try {
    const error: unknown = Reflect.get(JSON.parse(stdout) ?? {}, 'error');
    if (error === null || typeof error !== 'object') return null;
    const field = (name: string) => {
      const value: unknown = Reflect.get(error, name);
      return typeof value === 'string' ? value : '';
    };
    return { code: field('code'), summary: field('summary'), detail: field('detail') };
  } catch {
    return null;
  }
}

/** The message for an ERESOLVE, naming the package and the peer range that excludes Atd's. */
function conflictMessage(summary: string, detail: string): string {
  const match = /Could not resolve dependency:\n(?:peer )?(\S+?)@"([^"]*)" from (\S+?)@(\S+)/.exec(
    detail,
  );
  if (!match) return `The declared packages cannot be installed together: ${summary}.`;
  const [, peer = '', range = '', from = '', version = ''] = match;
  const pins = loadToolchain().peerPins;
  const pinned = pins[peer];
  if (pinned === undefined)
    return `${from} ${version} needs ${peer} ${range}, which the other packages rule out; choose versions that work together.`;
  const react = (pins.react ?? '').split('.')[0];
  return `${from} ${version} supports ${peer} ${range}, but apps run ${peer} ${pinned}; choose a package that supports React ${react}.`;
}

/** The package a registry URL in an npm summary names (`GET <url>`), or null. */
function requestedPackage(summary: string): string | null {
  const url = /GET (https?:\/\/\S+)/.exec(summary)?.[1];
  if (!url) return null;
  try {
    // `/<name>` for a packument, `/<name>/-/<file>.tgz` for a tarball; scopes come as `%2f`.
    const name = new URL(url).pathname.slice(1).split('/-/')[0] ?? '';
    return name ? decodeURIComponent(name) : null;
  } catch {
    return null;
  }
}

/** Maps npm's reported error to the code and message the agent reads. */
function npmFailure(stdout: string, stderr: string): NpmFailure {
  const reported = reportedError(stdout);
  if (!reported?.code) {
    const detail = `${stdout}${stderr}`.slice(-4000);
    const error: DependencyError = { code: 'dependency_failed', message: 'npm failed.', detail };
    return { npmCode: 'crashed', error };
  }
  const { code, summary, detail } = reported;
  const fail = (errorCode: DependencyError['code'], message: string): NpmFailure => ({
    npmCode: code,
    error: { code: errorCode, message, detail: `${summary}\n${detail}`.trim().slice(0, 4000) },
  });
  const missing = code === 'E404' ? requestedPackage(summary) : null;
  const target = /found for (.+?)@(.+?)( with a date before .*)?\.?$/.exec(summary);
  if (missing)
    return fail(
      'dependency_not_found',
      `No package "${missing}" exists on the npm registry; check the name.`,
    );
  if (code === 'ETARGET' && target) {
    const age = target[3] ? ` among releases at least ${MIN_RELEASE_AGE_DAYS} days old` : '';
    return fail(
      'dependency_no_version',
      `No version of ${target[1]} matches "${target[2]}"${age}.`,
    );
  }
  if (code === 'ERESOLVE') return fail('dependency_conflict', conflictMessage(summary, detail));
  if (code === 'EINTEGRITY')
    return fail(
      'dependency_integrity',
      'A downloaded package did not match its recorded checksum; nothing was installed.',
    );
  if (OFFLINE_CODES.has(code) || UNSENT_REQUEST.test(summary))
    return fail('dependency_offline', OFFLINE_MESSAGE);
  return fail('dependency_failed', `npm failed: ${summary || code}`);
}

/** Runs one npm command in the installer sandbox; never rejects for a failing npm. */
export async function runNpm(command: NpmCommand): Promise<NpmResult> {
  const toolchain = loadToolchain();
  const node = nodeBinary(command.nodePath);
  const home = path.join(command.scratch, 'npm-home');
  await fs.mkdir(home, { recursive: true });
  const { dirs, cwd } = command;
  const profile = writeProfile(
    command.scratch,
    'installer.sb',
    installerProfile({
      cwd,
      npmCache: dirs.cache,
      tmp: home,
      configDir: dirs.config,
      npmDir: toolchain.npm.dir,
      node,
    }),
  );
  const reads = [toolchain.npm.dir, cwd, dirs.cache, dirs.config, home];
  const run = await runSandboxed({
    command: SANDBOX_EXEC,
    args: [
      '-f',
      profile,
      node.path,
      '--permission',
      // One flag per path: Node 24 grants nothing for a comma-separated list.
      ...reads.map((dir) => `--allow-fs-read=${dir}`),
      ...[cwd, dirs.cache, home].map((dir) => `--allow-fs-write=${dir}`),
      toolchain.npm.cli,
      ...command.args,
      ...npmFlags(dirs, command.registry),
    ],
    env: { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: home, LANG: 'en_US.UTF-8' },
    cwd,
    timeoutMs: command.timeoutMs,
  });
  if (run.timedOut) {
    const message = `${command.activity} the dependencies took longer than ${command.timeoutMs / 1000} s.`;
    return {
      ok: false,
      failure: { npmCode: 'timeout', error: { code: 'dependency_timeout', message } },
    };
  }
  if (run.code === 0) return { ok: true, stdout: run.stdout };
  return { ok: false, failure: npmFailure(run.stdout, run.stderr) };
}

export type NpmSelfCheck = { ok: true; version: string } | { ok: false; reason: string };

/**
 * Proves npm runs in the installer sandbox with the given Node and takes its configuration from
 * the fixed flags, without touching the network: `npm --version` must be the pinned version, and
 * the effective registry, scripts and source settings must be the ones `runNpm` passes.
 */
export async function npmSelfCheck(options: {
  workDir: string;
  nodePath?: string;
}): Promise<NpmSelfCheck> {
  await fs.mkdir(options.workDir, { recursive: true });
  const root = await fs.mkdtemp(path.join(realpath(options.workDir), 'npm-check-'));
  try {
    const dirs = await npmDirs(root);
    const cwd = path.join(root, 'cwd');
    await fs.mkdir(cwd);
    const npm = (args: string[]) =>
      runNpm({
        args,
        cwd,
        dirs,
        scratch: root,
        timeoutMs: 30_000,
        activity: 'Checking',
        registry: NPM_REGISTRY,
        ...(options.nodePath ? { nodePath: options.nodePath } : {}),
      });
    const version = await npm(['--version']);
    if (!version.ok) return { ok: false, reason: version.failure.error.message };
    const expected = loadToolchain().npm.version;
    if (version.stdout.trim() !== expected)
      return { ok: false, reason: `npm reported ${version.stdout.trim()}, not ${expected}.` };
    const settings = ['registry', 'ignore-scripts', 'allow-git', 'allow-remote', 'allow-file'];
    const config = await npm(['config', 'get', ...settings, 'allow-directory']);
    if (!config.ok) return { ok: false, reason: config.failure.error.message };
    const wanted = `registry=${NPM_REGISTRY}\nignore-scripts=true\nallow-git=none\nallow-remote=none\nallow-file=none\nallow-directory=none`;
    if (config.stdout.trim() !== wanted)
      return { ok: false, reason: `npm's effective configuration differs: ${config.stdout}` };
    return { ok: true, version: expected };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
