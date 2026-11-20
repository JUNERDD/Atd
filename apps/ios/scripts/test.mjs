#!/usr/bin/env node
/**
 * Runs the package's Swift Testing suites on an iPhone simulator (scripts/simulator.mjs picks it):
 *
 *   node scripts/test.mjs
 *
 * The tests run through the generated project's Atd scheme, whose test action lists the package's
 * test targets (project.yml), so they build with the same settings as the app. The result bundle
 * lands in DerivedData/Test.xcresult, and its pass and fail counts are printed at the end.
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { pickSimulator } from './simulator.mjs';
import { fail, generateProject, packageRoot, projectArgs, run } from './xcode.mjs';

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
run('xcodebuild', [
  ...projectArgs,
  '-destination',
  `id=${simulator.udid}`,
  '-resultBundlePath',
  results,
  '-quiet',
  'test',
]);
const summary = JSON.parse(
  execFileSync('xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', results], {
    encoding: 'utf8',
  }),
);
process.stdout.write(
  `${summary.result}: ${summary.passedTests} passed, ${summary.failedTests} failed, ` +
    `${summary.skippedTests} skipped\n`,
);
if (summary.result !== 'Passed' || summary.passedTests === 0) process.exit(1);
