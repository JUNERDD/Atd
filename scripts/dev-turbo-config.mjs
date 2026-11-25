#!/usr/bin/env node
/**
 * Derives `turbo.dev.json`, the task graph `pnpm dev` runs Turbo watch with, from `turbo.json`.
 *
 * The copy differs only in caching the file-index addon, keyed by the compiler context that
 * `dev-native-cache.mjs` writes to `NATIVE_CONTEXT_FILE`. It is checked in on purpose: when macOS
 * FSEvents drops events, Turbo recovers by rehashing tracked files, but it cannot vouch for an
 * ignored root config and restarts every watch task instead.
 *
 * Usage: node scripts/dev-turbo-config.mjs --check | --write
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE_CONFIG = path.join(repository, 'turbo.json');
const NATIVE_TASK = '@atd/file-index#build';
const CONTEXT_INPUT = '.turbo/dev/native-context.json';

/** The checked-in dev task graph; only `syncDevTurboConfig` writes it. */
export const DEV_TURBO_CONFIG = path.join(repository, 'turbo.dev.json');
/** Ignored per-checkout compiler context that keys the cached addon. */
export const NATIVE_CONTEXT_FILE = path.join(repository, CONTEXT_INPUT);

/** Returns `turbo.json` with only the native task cached on its compiler context. */
function deriveDevTurboConfig(source) {
  const config = JSON.parse(source);
  const task = config.tasks?.[NATIVE_TASK];
  if (
    !task ||
    typeof task !== 'object' ||
    !Array.isArray(task.inputs) ||
    !task.inputs.every((input) => typeof input === 'string')
  ) {
    throw new Error(`${NATIVE_TASK} in turbo.json does not declare its inputs.`);
  }
  config.tasks[NATIVE_TASK] = {
    ...task,
    cache: true,
    inputs: [
      ...new Set([
        ...task.inputs,
        `$TURBO_ROOT$/${CONTEXT_INPUT}`,
        '$TURBO_ROOT$/scripts/dev-native-cache.mjs',
      ]),
    ],
  };
  return config;
}

async function readState() {
  const expected = deriveDevTurboConfig(await readFile(SOURCE_CONFIG, 'utf8'));
  let current = null;
  try {
    current = JSON.parse(await readFile(DEV_TURBO_CONFIG, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return { expected, upToDate: isDeepStrictEqual(current, expected) };
}

/** Rewrites `turbo.dev.json` when it no longer matches `turbo.json`; resolves to whether it did. */
export async function syncDevTurboConfig() {
  const { expected, upToDate } = await readState();
  if (upToDate) return false;
  // Formatted like the checked-in file so the rewrite passes `pnpm format:check` unchanged.
  const { format } = await import('oxfmt');
  const { code, errors } = await format(
    path.basename(DEV_TURBO_CONFIG),
    `${JSON.stringify(expected, null, 2)}\n`,
    {},
  );
  if (errors.length > 0) throw new Error(`Could not format turbo.dev.json: ${errors[0].message}`);
  await writeFile(DEV_TURBO_CONFIG, code);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  if (rest.length > 0 || !['--check', '--write'].includes(mode)) {
    throw new Error('Usage: dev-turbo-config.mjs --check | --write');
  }
  if (mode === '--write') {
    const updated = await syncDevTurboConfig();
    console.log(updated ? 'Updated turbo.dev.json.' : 'turbo.dev.json is up to date.');
  } else if (!(await readState()).upToDate) {
    console.error(
      'turbo.dev.json does not match turbo.json. Run `node scripts/dev-turbo-config.mjs --write` (pnpm dev also rewrites it) and commit the result.',
    );
    process.exitCode = 1;
  }
}
