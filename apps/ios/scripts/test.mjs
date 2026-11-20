#!/usr/bin/env node
/**
 * Runs the package's Swift Testing suites on an iPhone simulator (scripts/simulator.mjs picks it):
 *
 *   node scripts/test.mjs
 *
 * The tests run through the generated project's Atd scheme, whose test action lists the package's
 * test targets (project.yml), so they build with the same settings as the app. The result bundle
 * lands in DerivedData/Test.xcresult; the counts, and every failure's message, are printed at the
 * end.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pickSimulator } from './simulator.mjs';
import { fail, generateProject, packageRoot, projectArgs } from './xcode.mjs';

let simulator;
try {
  simulator = pickSimulator();
} catch (error) {
  fail(error.message);
}
process.stdout.write(`Testing on ${simulator.name} (iOS ${simulator.version.join('.')})\n`);
const results = path.join(packageRoot, 'DerivedData', 'Test.xcresult');
// xcodebuild refuses to write over an existing result bundle.
rmSync(results, { recursive: true, force: true });
generateProject();
const test = spawnSync(
  'xcodebuild',
  [
    ...projectArgs,
    '-destination',
    `id=${simulator.udid}`,
    '-resultBundlePath',
    results,
    '-quiet',
    'test',
  ],
  { cwd: packageRoot, stdio: 'inherit' },
);
if (test.error) fail(`could not run xcodebuild: ${test.error.message}`);
// A build failure leaves no result bundle; xcodebuild has printed its errors.
if (!existsSync(results)) process.exit(test.status || 1);

const read = (kind) =>
  JSON.parse(
    execFileSync('xcrun', ['xcresulttool', 'get', 'test-results', kind, '--path', results], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  );

/** Prints each failed test (and, for a parameterized one, its arguments) with its messages. */
function printFailures(node, trail = []) {
  const named = node.nodeType === 'Test Case' || node.nodeType === 'Arguments';
  const here = named ? [...trail, node.name] : trail;
  if (node.nodeType === 'Failure Message')
    process.stdout.write(`  ${trail.join(' › ')}: ${node.name}\n`);
  for (const child of node.children ?? []) printFailures(child, here);
}

const summary = read('summary');
process.stdout.write(
  `${summary.result}: ${summary.passedTests} passed, ${summary.failedTests} failed, ` +
    `${summary.skippedTests} skipped\n`,
);
if (summary.failedTests > 0) for (const node of read('tests').testNodes) printFailures(node);
if (test.status !== 0 || summary.result !== 'Passed' || summary.passedTests === 0) process.exit(1);
