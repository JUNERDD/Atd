#!/usr/bin/env node
/**
 * Builds the app and its extensions for the iOS Simulator:
 *
 *   node scripts/build.mjs [--configuration <Debug|Release>]
 *
 * It regenerates Atd.xcodeproj with XcodeGen and runs xcodebuild for a generic simulator into
 * DerivedData/Build/Products/<Configuration>-iphonesimulator/Atd.app. Simulator builds are signed
 * to run locally, so no development team is needed.
 */
import { parseArgs } from 'node:util';
import { fail, generateProject, projectArgs, run } from './xcode.mjs';

const CONFIGURATIONS = ['Debug', 'Release'];

let options;
try {
  options = parseArgs({
    options: { configuration: { type: 'string', default: 'Debug' } },
    strict: true,
  }).values;
} catch (error) {
  fail(error.message);
}
if (!CONFIGURATIONS.includes(options.configuration))
  fail(`--configuration must be ${CONFIGURATIONS.join(' or ')}, not ${options.configuration}.`);

generateProject();
run('xcodebuild', [
  ...projectArgs,
  '-configuration',
  options.configuration,
  '-destination',
  'generic/platform=iOS Simulator',
  '-quiet',
  'build',
]);
