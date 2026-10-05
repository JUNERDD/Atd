import fs from 'node:fs/promises';
import path from 'node:path';
import { SANDBOX_EXEC, tscProfile, writeProfile } from './seatbelt.js';
import { runSandboxed } from './spawn.js';
import type { StagedApp } from './staging.js';
import { isInside, loadToolchain, realpath } from './toolchain.js';

/**
 * Step 3 of an app build: `tsc --noEmit` over a copy of the staged app. The result never blocks
 * a build; it is shown to the agent as diagnostics. The service writes the project scaffold:
 * `tsconfig.json`, a `declare module '*.css'` shim, and a `node_modules` of symlinks to the
 * allow-listed packages only (tsconfig `paths` cannot express subpath exports such as
 * `@atd/ui/components/*`).
 */

export const TYPECHECK_TIMEOUT_MS = 60_000;
const MAX_DIAGNOSTICS = 200;

export interface TypecheckDiagnostic {
  /** Relative to the app root for app files; absolute for toolchain files. */
  file: string;
  line: number;
  column: number;
  /** `TS2322` and the like. */
  code: string;
  message: string;
}

export interface TypecheckOptions {
  app: StagedApp;
  /** Scratch directory; the project copy and the sandbox profile go here. */
  workDir: string;
  timeoutMs?: number;
}

export interface TypecheckResult {
  ok: boolean;
  errorCount: number;
  /** The first 200 diagnostics. */
  diagnostics: TypecheckDiagnostic[];
  durationMs: number;
  /** Why `tsc` produced no verdict (timeout, crash); absent when it ran to completion. */
  failure?: string;
}

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2025', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'Bundler',
    jsx: 'react-jsx',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    verbatimModuleSyntax: true,
    allowImportingTsExtensions: true,
    // The client SDK imports the runtime's shared `.mjs` helpers.
    allowJs: true,
    types: ['node'],
  },
  include: ['web/src', 'server', 'shared', 'atd-env.d.ts'],
};

/**
 * The backend runtime's modules, which the SDKs import, as explicit program files. In the Release
 * service pack app-kit itself lies inside `node_modules`, where `tsc` leaves imported `.mjs` files
 * out of the program as untyped library code (TS7016) unless they are already part of it; in the
 * workspace they are loaded either way. JavaScript is not checked (`checkJs` is off).
 */
async function runtimeModules(runtimeDir: string): Promise<string[]> {
  const names = await fs.readdir(runtimeDir);
  return names
    .filter((name) => name.endsWith('.mjs'))
    .sort()
    .map((name) => path.join(runtimeDir, name));
}

/** Creates `node_modules/<name>` → `target` links for the allow-listed packages. */
async function linkPackages(projectDir: string, packages: Record<string, string>) {
  for (const [name, target] of Object.entries(packages)) {
    const link = path.join(projectDir, 'node_modules', ...name.split('/'));
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(target, link, 'dir');
  }
}

const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/** Parses `tsc --pretty false` output; continuation lines extend the previous message. */
export function parseTscOutput(output: string, projectDir: string): TypecheckDiagnostic[] {
  const diagnostics: TypecheckDiagnostic[] = [];
  for (const line of output.split('\n')) {
    const match = DIAGNOSTIC.exec(line);
    if (match) {
      const absolute = path.resolve(projectDir, match[1] ?? '');
      diagnostics.push({
        file: isInside(absolute, projectDir) ? path.relative(projectDir, absolute) : absolute,
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[4] ?? '',
        message: match[5] ?? '',
      });
    } else if (/^\s+\S/.test(line) && diagnostics.length > 0) {
      const last = diagnostics[diagnostics.length - 1];
      if (last) last.message += `\n${line.trim()}`;
    }
  }
  return diagnostics;
}

/**
 * Typechecks a staged app with the native `tsc` inside its own Seatbelt profile (no network, no
 * writes, reads under `/Users` only the project copy and the toolchain): `tsc` is a native binary,
 * so Node's permission model does not apply to it.
 */
export async function typecheckApp(options: TypecheckOptions): Promise<TypecheckResult> {
  const started = performance.now();
  const toolchain = loadToolchain();
  await fs.mkdir(options.workDir, { recursive: true });
  const projectDir = path.join(realpath(options.workDir), 'typecheck');
  await fs.rm(projectDir, { recursive: true, force: true });
  await fs.cp(options.app.dir, projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'tsconfig.json'),
    `${JSON.stringify({ ...TSCONFIG, files: await runtimeModules(toolchain.runtimeDir) }, null, 2)}\n`,
  );
  await fs.writeFile(path.join(projectDir, 'atd-env.d.ts'), "declare module '*.css';\n");
  await linkPackages(projectDir, toolchain.typePackages);

  const profile = writeProfile(
    options.workDir,
    'tsc.sb',
    tscProfile({ projectDir, readRoots: toolchain.readRoots, tsc: toolchain.tsc }),
  );
  const run = await runSandboxed({
    command: SANDBOX_EXEC,
    args: [
      '-f',
      profile,
      toolchain.tsc,
      '-p',
      path.join(projectDir, 'tsconfig.json'),
      '--pretty',
      'false',
    ],
    env: { LANG: 'en_US.UTF-8' },
    cwd: projectDir,
    timeoutMs: options.timeoutMs ?? TYPECHECK_TIMEOUT_MS,
  });
  const durationMs = Math.round(performance.now() - started);
  const diagnostics = parseTscOutput(run.stdout, projectDir);
  // tsc exits 0 when clean and 1 or 2 with diagnostics; anything else gave no verdict.
  const verdict = run.code === 0 || ((run.code === 1 || run.code === 2) && diagnostics.length > 0);
  if (run.timedOut || !verdict) {
    const reason = run.timedOut ? 'timed out' : `exited with ${run.signal ?? run.code}`;
    return {
      ok: false,
      errorCount: diagnostics.length,
      diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
      durationMs,
      failure: `tsc ${reason}. ${`${run.stdout}${run.stderr}`.slice(-2000)}`.trim(),
    };
  }
  return {
    ok: diagnostics.length === 0,
    errorCount: diagnostics.length,
    diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
    durationMs,
  };
}
