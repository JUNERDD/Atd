/**
 * What build.mjs and test.mjs share: the package root, running a tool with inherited output, and
 * regenerating Atd.xcodeproj from project.yml (the project is never checked in).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function fail(message) {
  process.stderr.write(`ios: ${message}\n`);
  process.exit(1);
}

/** Runs `command` in the package root and exits with its status when it fails. */
export function run(command, args) {
  const result = spawnSync(command, args, { cwd: packageRoot, stdio: 'inherit' });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function generateProject() {
  run('xcodegen', ['generate', '--quiet']);
}

/** xcodebuild arguments every invocation shares: the generated project and its scheme. */
export const projectArgs = [
  '-project',
  'Atd.xcodeproj',
  '-scheme',
  'Atd',
  '-derivedDataPath',
  'DerivedData',
];
