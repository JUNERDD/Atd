import fs from 'node:fs/promises';
import path from 'node:path';
import { internal } from './backend.js';
import { SANDBOX_EXEC } from './seatbelt.js';
import { runSandboxed } from './spawn.js';
import { loadToolchain, realpath } from './toolchain.js';

/**
 * Seatbelt is deprecated and path-based, and without it `node:sqlite` writes anywhere despite the
 * permission model (T1). Before starting backends the service runs this probe under the real
 * backend profile and flags; if an out-of-bounds write succeeds (or the probe cannot show that
 * in-bounds writes work), the sandbox is not trustworthy on this system and no backend may start.
 */

export type SandboxSelfCheck = { ok: true } | { ok: false; reason: string };

export interface SelfCheckOptions {
  /** Scratch directory for the probe's version, data and outside directories. */
  workDir: string;
  nodePath?: string;
  timeoutMs?: number;
}

const PROBE = `
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const [outside] = process.argv.slice(2);
const attempt = (fn) => { try { fn(); return 'allowed'; } catch { return 'denied'; } };
const result = {
  insideSqlite: attempt(() => { const db = new DatabaseSync('inside.db'); db.exec('CREATE TABLE t (x)'); db.close(); }),
  outsideSqlite: attempt(() => { const db = new DatabaseSync(path.join(outside, 'escape.db')); db.exec('CREATE TABLE t (x)'); db.close(); }),
  outsideAttach: attempt(() => { const db = new DatabaseSync(':memory:'); db.exec("ATTACH DATABASE '" + path.join(outside, 'attach.db') + "' AS o; CREATE TABLE o.t (x)"); db.close(); }),
  outsideFile: attempt(() => fs.writeFileSync(path.join(outside, 'escape.txt'), 'x')),
  signalParent: attempt(() => process.kill(process.ppid, 0)),
};
process.stdout.write(JSON.stringify(result));
`;

/** Runs the backend-sandbox probe; `ok` only when every escape failed and in-bounds work did. */
export async function selfCheckSandbox(options: SelfCheckOptions): Promise<SandboxSelfCheck> {
  await fs.mkdir(options.workDir, { recursive: true });
  const root = await fs.mkdtemp(path.join(realpath(options.workDir), 'sandbox-check-'));
  try {
    const versionDir = path.join(root, 'version');
    const dataDir = path.join(root, 'data');
    const outside = path.join(root, 'outside');
    for (const dir of [versionDir, dataDir, outside]) await fs.mkdir(dir);
    await fs.writeFile(path.join(versionDir, 'probe.mjs'), PROBE);
    const dirs = { versionDir, runtimeDir: loadToolchain().runtimeDir, dataDir };
    const profilePath = internal.writeBackendProfile(
      root,
      'backend-check.sb',
      dirs,
      options.nodePath,
    );
    const run = await runSandboxed({
      command: SANDBOX_EXEC,
      args: internal.sandboxedNodeArgs({
        ...dirs,
        profilePath,
        entry: path.join(versionDir, 'probe.mjs'),
        entryArgs: [outside],
        nodePath: options.nodePath,
      }),
      env: { LANG: 'en_US.UTF-8' },
      cwd: dataDir,
      timeoutMs: options.timeoutMs ?? 20_000,
    });
    const escaped = await fs.readdir(outside);
    if (escaped.length > 0)
      return {
        ok: false,
        reason: `The probe wrote outside its data directory: ${escaped.join(', ')}.`,
      };
    let result: unknown;
    try {
      result = JSON.parse(run.stdout);
    } catch {
      return {
        ok: false,
        reason: `The probe did not run (${run.code ?? run.signal}): ${run.stderr.slice(-1000)}`,
      };
    }
    const field = (name: string): unknown =>
      result !== null && typeof result === 'object' ? Reflect.get(result, name) : undefined;
    if (field('insideSqlite') !== 'allowed')
      return { ok: false, reason: 'The probe could not write its own data directory.' };
    for (const escape of ['outsideSqlite', 'outsideAttach', 'outsideFile', 'signalParent']) {
      if (field(escape) !== 'denied')
        return { ok: false, reason: `The sandbox allowed ${escape}.` };
    }
    return { ok: true };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
