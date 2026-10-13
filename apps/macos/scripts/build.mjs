#!/usr/bin/env node
/**
 * The one entry that builds the native app, for Debug (`pnpm --filter @atd/macos build`, which
 * `pnpm dev` runs) and Release (`build:release`, after `bundle` staged the service pack):
 *
 *   node scripts/build.mjs --configuration <Debug|Release> [--arch <arm64|x64>]
 *     [--marketing-version <v>] [--build-version <v>] [--dry-run]
 *
 * It regenerates the Xcode project with XcodeGen and runs xcodebuild into
 * DerivedData/Build/Products/<Configuration>/Atd.app.
 *
 * The app is built for the host's native architecture only: the service pack staged beside it
 * (Node, the native addons and the app toolchain) comes from this host's install, so an app for
 * another architecture would embed code it cannot run. `--arch` therefore only confirms the
 * target, and a mismatch fails; with `--dry-run` it prints the xcodebuild invocation for that
 * architecture without running anything, which is how the x64 mapping is inspected on an arm64
 * host. The native architecture is read from `hw.optional.arm64`, which stays 1 under Rosetta.
 *
 * x64 builds read their Sparkle feed from the x64 appcast (`ATD_SPARKLE_FEED_URL`); every build
 * keeps `ATD_SPARKLE_ARM64_FEED_URL` from project.yml, the feed a Rosetta process moves to.
 * `--marketing-version` and `--build-version` override MARKETING_VERSION and
 * CURRENT_PROJECT_VERSION for release candidates; Sparkle compares the build version and stops
 * at a `-`, so a build version must not contain one.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const X64_FEED_URL = 'https://downloads.atd.best/appcast-x64.xml';
/** Node's architecture names mapped to Xcode's and Mach-O's. */
const XCODE_ARCHS = { arm64: 'arm64', x64: 'x86_64' };
const CONFIGURATIONS = ['Debug', 'Release'];

function fail(message) {
  process.stderr.write(`build: ${message}\n`);
  process.exit(1);
}

/** The architecture this Mac runs natively, whatever architecture this Node process runs as. */
function hostArch() {
  if (process.platform !== 'darwin')
    fail(`the native app builds on macOS only, not ${process.platform}.`);
  const probe = spawnSync('sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' });
  if (probe.stdout?.trim() === '1') return 'arm64';
  if (process.arch === 'x64') return 'x64';
  fail(`unsupported macOS architecture ${process.arch}; the app builds for arm64 or x64.`);
}

function readOptions() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        configuration: { type: 'string' },
        arch: { type: 'string' },
        'marketing-version': { type: 'string' },
        'build-version': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
      },
      strict: true,
    }).values;
  } catch (error) {
    fail(error.message);
  }
  const configuration = parsed.configuration;
  if (!CONFIGURATIONS.includes(configuration))
    fail(
      `--configuration must be ${CONFIGURATIONS.join(' or ')}, not ${configuration ?? '(none)'}.`,
    );
  if (parsed.arch !== undefined && !(parsed.arch in XCODE_ARCHS))
    fail(`--arch must be arm64 or x64, not ${parsed.arch}.`);
  const marketingVersion = parsed['marketing-version'];
  const buildVersion = parsed['build-version'];
  for (const [flag, value] of [
    ['--marketing-version', marketingVersion],
    ['--build-version', buildVersion],
  ]) {
    if (value !== undefined && !/^\S+$/.test(value)) fail(`${flag} must be a non-empty version.`);
  }
  if (buildVersion?.includes('-'))
    fail(`--build-version ${buildVersion} contains '-', where Sparkle stops comparing versions.`);
  // CURRENT_PROJECT_VERSION defaults to $(MARKETING_VERSION), so the rule holds for it too.
  if (marketingVersion?.includes('-') && buildVersion === undefined)
    fail(
      `--marketing-version ${marketingVersion} contains '-'; pass a --build-version without one.`,
    );
  return {
    configuration,
    arch: parsed.arch,
    marketingVersion,
    buildVersion,
    dryRun: parsed['dry-run'],
  };
}

/** The xcodebuild arguments for one configuration and architecture. */
function xcodebuildArgs({ configuration, arch, marketingVersion, buildVersion }) {
  const xcodeArch = XCODE_ARCHS[arch];
  return [
    '-project',
    'AI.xcodeproj',
    '-scheme',
    'AI',
    '-configuration',
    configuration,
    '-destination',
    `platform=macOS,arch=${xcodeArch}`,
    '-derivedDataPath',
    'DerivedData',
    '-quiet',
    // Also covers the AIMac package targets, whose Release builds otherwise include both slices.
    `ARCHS=${xcodeArch}`,
    ...(arch === 'x64' ? [`ATD_SPARKLE_FEED_URL=${X64_FEED_URL}`] : []),
    ...(marketingVersion === undefined ? [] : [`MARKETING_VERSION=${marketingVersion}`]),
    ...(buildVersion === undefined ? [] : [`CURRENT_PROJECT_VERSION=${buildVersion}`]),
    'build',
  ];
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: packageRoot, stdio: 'inherit' });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const options = readOptions();
const native = hostArch();
const arch = options.arch ?? native;
const args = xcodebuildArgs({ ...options, arch });
if (options.dryRun) {
  process.stdout.write(`${JSON.stringify(['xcodebuild', ...args])}\n`);
  if (arch !== native)
    process.stdout.write(
      `note: this host builds ${native} natively; a real ${arch} build would refuse to run here.\n`,
    );
  process.exit(0);
}
if (arch !== native)
  fail(`--arch ${arch} does not match this host's native ${native}; build on an ${arch} Mac.`);
run('xcodegen', ['generate', '--quiet']);
run('xcodebuild', args);
