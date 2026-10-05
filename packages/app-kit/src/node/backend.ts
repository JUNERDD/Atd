import { APP_ID_PATTERN } from '@atd/agent-contracts';
import fs from 'node:fs';
import path from 'node:path';
import { backendProfile, SANDBOX_EXEC, writeProfile } from './seatbelt.js';
import { loadToolchain, nodeBinary, realpath } from './toolchain.js';

/**
 * How the service launches an app backend: `sandbox-exec -f <backend.sb> node --permission
 * --allow-fs-read=<versionDir> --allow-fs-read=<runtimeDir> --allow-fs-read=<dataDir>
 * --allow-fs-write=<dataDir> <runtimeDir>/bootstrap.mjs <versionDir>` with cwd = dataDir and a
 * Node IPC channel on fd 3. No `--allow-child-process`, `--allow-worker` or `--allow-addons`.
 */

export interface BackendSpawnOptions {
  /** `<dataDir>/apps/<appId>/versions/<n>`; must hold `server/index.mjs`. */
  versionDir: string;
  /** `<dataDir>/apps/<appId>/data`; created if missing. The backend's only writable place. */
  dataDir: string;
  appId: string;
  /** Where the generated profile is written (`backend-<appId>.sb`). */
  profileDir: string;
  /** The Node binary; defaults to the service's own. */
  nodePath?: string;
  /** `LANG` for the backend; defaults to the service's, else `en_US.UTF-8`. */
  lang?: string;
  /** `TZ` for the backend; defaults to the service's resolved time zone. */
  timeZone?: string;
}

/** Pass to `child_process.spawn(command, args, { env, cwd, stdio })` as is. */
export interface BackendSpawnSpec {
  command: typeof SANDBOX_EXEC;
  args: string[];
  /**
   * A fresh environment: only `LANG`, `TZ` and `ATD_APP_ID`. Never `process.env` (the user's
   * shell environment holds API keys) and never `NODE_OPTIONS`, which can widen the permission
   * model (T1: `NODE_OPTIONS=--allow-fs-read=*`).
   */
  env: { LANG: string; TZ: string; ATD_APP_ID: string };
  cwd: string;
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'];
  profilePath: string;
}

interface CommandOptions {
  versionDir: string;
  dataDir: string;
  profilePath: string;
  entry: string;
  entryArgs: string[];
  nodePath: string | undefined;
}

/** The sandbox-exec argv around `node --permission … <entry>`, shared with the self-check. */
function sandboxedNodeArgs(options: CommandOptions & { runtimeDir: string }): string[] {
  const node = nodeBinary(options.nodePath);
  return [
    '-f',
    options.profilePath,
    node.path,
    '--permission',
    // One flag per path: Node 24 grants nothing for a comma-separated list.
    `--allow-fs-read=${options.versionDir}`,
    `--allow-fs-read=${options.runtimeDir}`,
    `--allow-fs-read=${options.dataDir}`,
    `--allow-fs-write=${options.dataDir}`,
    options.entry,
    ...options.entryArgs,
  ];
}

function writeBackendProfile(
  profileDir: string,
  name: string,
  dirs: { versionDir: string; runtimeDir: string; dataDir: string },
  nodePath: string | undefined,
): string {
  return writeProfile(profileDir, name, backendProfile({ ...dirs, node: nodeBinary(nodePath) }));
}

const APP_ID = new RegExp(APP_ID_PATTERN);

/** Generates the app's backend profile and returns how to spawn its backend. */
export function backendSpawnSpec(options: BackendSpawnOptions): BackendSpawnSpec {
  if (!APP_ID.test(options.appId)) throw new Error(`Invalid app id: ${options.appId}`);
  const versionDir = realpath(options.versionDir);
  if (
    !fs.statSync(path.join(versionDir, 'server', 'index.mjs'), { throwIfNoEntry: false })?.isFile()
  ) {
    throw new Error(`${versionDir} has no server/index.mjs.`);
  }
  fs.mkdirSync(options.dataDir, { recursive: true });
  const dataDir = realpath(options.dataDir);
  const runtimeDir = loadToolchain().runtimeDir;
  const profilePath = writeBackendProfile(
    options.profileDir,
    `backend-${options.appId}.sb`,
    { versionDir, runtimeDir, dataDir },
    options.nodePath,
  );
  return {
    command: SANDBOX_EXEC,
    args: sandboxedNodeArgs({
      versionDir,
      runtimeDir,
      dataDir,
      profilePath,
      entry: path.join(runtimeDir, 'bootstrap.mjs'),
      entryArgs: [versionDir],
      nodePath: options.nodePath,
    }),
    env: {
      LANG: options.lang ?? process.env.LANG ?? 'en_US.UTF-8',
      TZ: options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      ATD_APP_ID: options.appId,
    },
    cwd: dataDir,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    profilePath,
  };
}

/** Exported for the self-check, which runs a probe under the same profile and flags. */
export const internal = { sandboxedNodeArgs, writeBackendProfile };
