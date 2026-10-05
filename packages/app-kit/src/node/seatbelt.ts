import fs from 'node:fs';
import path from 'node:path';
import type { NodeBinary } from './toolchain.js';
import { realpath } from './toolchain.js';

/**
 * macOS Seatbelt (`sandbox-exec`) profiles for the three processes that touch agent-written code:
 * the app backend, the builder and `tsc`. Each runs under Node's permission model too where it is
 * a Node process, and both layers are needed (T1): the permission model does not confine
 * `node:sqlite` (open/ATTACH/VACUUM INTO/backup write anywhere), `process.kill`, the network, or
 * any native addon (`--allow-addons`, which rolldown, lightningcss and oxide need, lets native
 * code read and write freely); Seatbelt does not know Node's module semantics. Profiles are
 * path-based, so every path in them is a realpath; they start from `allow default` and deny the
 * classes of operation that matter, which keeps system frameworks working.
 */

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

/** A Seatbelt string literal; paths with quotes, backslashes or control characters are refused. */
function str(value: string): string {
  if (/["\\\p{Cc}]/u.test(value))
    throw new Error(`Unsupported character in sandbox path: ${value}`);
  return `"${value}"`;
}

const subpaths = (dirs: string[]) => dirs.map((dir) => `(subpath ${str(dir)})`).join(' ');

/** Writes only to `dirs` plus the device files every process needs. */
function writesOnly(dirs: string[]): string[] {
  return [
    '(deny file-write*)',
    `(allow file-write* ${subpaths(dirs)} (literal "/dev/null") (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))`,
  ];
}

/** No signals to other processes, no fork, and exec of `binaries` only. */
function processRules(binaries: string[]): string[] {
  const literals = [...new Set(binaries)].map((file) => `(literal ${str(file)})`).join(' ');
  return [
    '(deny signal)',
    '(allow signal (target self))',
    '(deny process-fork)',
    '(deny process-exec*)',
    `(allow process-exec* ${literals})`,
  ];
}

/**
 * Under `/Users` (home directories, and the repository in development) only `dirs` are readable;
 * metadata stays readable so path resolution works. System locations outside `/Users` stay
 * readable for frameworks and the runtime.
 */
function homeReadsOnly(dirs: string[]): string[] {
  return [
    '(deny file-read* (subpath "/Users"))',
    `(allow file-read* ${subpaths(dirs)})`,
    '(allow file-read-metadata (subpath "/Users"))',
  ];
}

export interface BackendProfileOptions {
  versionDir: string;
  runtimeDir: string;
  dataDir: string;
  node: NodeBinary;
}

/**
 * The app backend: outbound internet is a backend capability (apps may call third-party APIs),
 * but loopback (this service, dev servers), unix sockets and listening are denied; writes go only
 * to the data directory.
 */
export function backendProfile(options: BackendProfileOptions): string {
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(allow network-outbound (remote ip "*:*"))',
    '(deny network-outbound (remote ip "localhost:*"))',
    // DNS goes through mDNSResponder's unix socket.
    '(allow network-outbound (literal "/private/var/run/mDNSResponder"))',
    '(allow system-socket)',
    ...writesOnly([options.dataDir]),
    ...processRules([options.node.path, options.node.realPath]),
    ...homeReadsOnly([
      options.versionDir,
      options.runtimeDir,
      options.dataDir,
      options.node.prefix,
      path.dirname(options.node.realPath),
    ]),
    '',
  ].join('\n');
}

export interface BuilderProfileOptions {
  stagingDir: string;
  outDir: string;
  readRoots: string[];
  node: NodeBinary;
}

/** The builder: no network at all; reads the app and the toolchain; writes only the output. */
export function builderProfile(options: BuilderProfileOptions): string {
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    ...writesOnly([options.outDir]),
    ...processRules([options.node.path, options.node.realPath]),
    ...homeReadsOnly([
      options.stagingDir,
      options.outDir,
      ...options.readRoots,
      options.node.prefix,
      path.dirname(options.node.realPath),
    ]),
    '',
  ].join('\n');
}

export interface TscProfileOptions {
  projectDir: string;
  readRoots: string[];
  tsc: string;
}

/** `tsc --noEmit`: a native binary outside Node's permission model, so Seatbelt is its only fence. */
export function tscProfile(options: TscProfileOptions): string {
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    ...writesOnly([]),
    ...processRules([options.tsc]),
    ...homeReadsOnly([options.projectDir, ...options.readRoots]),
    '',
  ].join('\n');
}

/** Writes a profile into `dir` (created if needed) and returns its real path. */
export function writeProfile(dir: string, name: string, profile: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(realpath(dir), name);
  fs.writeFileSync(file, profile, { mode: 0o600 });
  return file;
}
