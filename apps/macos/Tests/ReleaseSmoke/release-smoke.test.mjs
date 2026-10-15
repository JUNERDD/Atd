import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { execute, packagedApp, requireIntelRunner } from './app-process.mjs';
import { afterRestart, beforeRestart, CORE_CASES, removeProvider } from './core-cases.mjs';
import { collectEvidence, writeReport } from './evidence.mjs';
import { startModelFixture } from './model-fixture.mjs';

await test('packaged x64 Release on macOS 15', { timeout: 300000 }, async () => {
  // Fail before launching anything on a developer Mac, self-hosted runner or ARM/Rosetta host.
  const environment = await requireIntelRunner();
  const evidence = process.env.ATD_SMOKE_EVIDENCE;
  assert.ok(evidence && process.env.ATD_SMOKE_DRIVER && process.env.APP && process.env.RUNNER_TEMP);
  await mkdir(evidence, { recursive: true });
  const dataDir = await mkdtemp(path.join(process.env.RUNNER_TEMP, 'atd-release-smoke-'));
  const started = Date.now();
  const names = [
    'native startup and visible window',
    ...CORE_CASES.slice(0, 8),
    'normal quit stops owned service',
    'native restart and visible window',
    ...CORE_CASES.slice(8),
    'final normal quit',
    'bundle signing identity and seal remain unchanged',
  ];
  const report = {
    environment: {
      ...environment,
      commit: process.env.GITHUB_SHA,
      run: process.env.GITHUB_RUN_ID,
      architecture: 'x86_64',
      node: process.version,
      model: 'loopback synthetic Chat Completions',
    },
    cases: names.map((name) => ({ name, status: 'UNTESTED' })),
    notes: [],
    windows: [],
    appPids: [],
  };
  const state = { otherTasks: [] };
  let app;
  let fixture;
  let api;
  let failure;
  async function check(name, run) {
    const result = report.cases.find((item) => item.name === name);
    assert.ok(result, `Unlisted case: ${name}`);
    const start = Date.now();
    try {
      await run();
      result.status = 'PASS';
      console.log(`PASS: ${name}`);
    } catch (error) {
      result.status = 'FAIL';
      result.detail = String(error.message).replaceAll('\n', ' ').replaceAll('|', '/');
      throw error;
    } finally {
      result.durationMs = Date.now() - start;
    }
  }
  try {
    app = await packagedApp(process.env.APP, process.env.ATD_SMOKE_DRIVER, dataDir);
    report.environment.serviceBuildId = app.buildId;
    const plist = path.join(app.app, 'Contents/Info.plist');
    for (const key of ['CFBundleShortVersionString', 'CFBundleVersion', 'LSMinimumSystemVersion']) {
      report.environment[key] = (
        await execute('/usr/bin/plutil', ['-extract', key, 'raw', plist])
      ).stdout.trim();
    }
    report.environment.dmgDigest = (
      await readFile(path.join('dmg', `${process.env.DMG}.sha256`), 'utf8')
    ).trim();
    const signature = await execute('/usr/bin/codesign', ['-d', '-r-', '--verbose=2', app.app]);
    report.environment.signature = signature.stderr.trim();
    report.environment.webkit = (
      await execute('/usr/bin/plutil', [
        '-extract',
        'CFBundleVersion',
        'raw',
        '/System/Library/Frameworks/WebKit.framework/Resources/Info.plist',
      ])
    ).stdout.trim();
    fixture = await startModelFixture();
    async function launch() {
      const launched = await app.launch();
      api = launched.api;
      report.windows.push(launched.window);
      report.appPids.push(launched.window.pid);
    }
    await check(names[0], launch);
    const first = { ...app.endpoint };
    await beforeRestart(api, fixture, check, state);
    await check('normal quit stops owned service', () => app.quit());
    api = undefined;
    await check('native restart and visible window', async () => {
      await launch();
      assert.notEqual(app.endpoint.pid, first.pid);
      assert.equal(app.endpoint.serviceId, first.serviceId);
      assert.ok(app.endpoint.epoch > first.epoch);
    });
    await afterRestart(api, fixture, check, state);
    report.streamEvents = state.streamEvents;
    // Capture before quitting, using only the runner's existing capture grant.
    await collectEvidence(evidence, app, report, started, true);
    await check('final normal quit', () => app.quit());
    api = undefined;
    await check('bundle signing identity and seal remain unchanged', async () => {
      await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', app.app]);
      const after = await execute('/usr/bin/codesign', ['-d', '-r-', '--verbose=2', app.app]);
      assert.equal(after.stderr.trim(), report.environment.signature);
    });
  } catch (error) {
    failure = error;
  } finally {
    const cleanup = async (name, run) => {
      try {
        await run();
      } catch (error) {
        report.notes.push(`${name}: ${error.message}`);
        failure ??= error;
      }
    };
    if (app?.pid && !report.appPids.includes(app.pid)) report.appPids.push(app.pid);
    if (failure)
      await cleanup('Capture failure evidence', () =>
        collectEvidence(evidence, app, report, started, true),
      );
    if (api && state.connectionId)
      await cleanup('Remove synthetic provider', () => removeProvider(api, state));
    if (app) await cleanup('Stop owned processes', () => app.cleanup());
    if (fixture) await cleanup('Close loopback fixture', () => fixture.close());
    if (failure)
      report.notes.push(`Run failed: ${failure.message}. Unreached cases remain UNTESTED.`);
    report.result = failure ? 'FAIL' : 'PASS';
    // Save fixture modes without the provider's request bodies or headers.
    report.modelRequests = fixture?.calls.map(({ mode, streaming }) => ({ mode, streaming })) ?? [];
    const redact = await collectEvidence(evidence, app, report, started);
    await writeReport(evidence, report, redact);
    await rm(dataDir, { recursive: true, force: true });
  }
  if (failure)
    throw new Error('Release smoke failed; see the case report and logs', { cause: failure });
});
