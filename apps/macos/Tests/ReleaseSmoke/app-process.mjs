import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readEndpoint, serviceClient, until } from './service-client.mjs';

export const execute = promisify(execFile);

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};

/** This destructive lifecycle test is deliberately restricted to ephemeral hosted Intel CI. */
export async function requireIntelRunner() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Run this suite in GitHub Actions');
  assert.equal(
    process.env.RUNNER_ENVIRONMENT,
    'github-hosted',
    'A fresh hosted runner is required',
  );
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'x64', 'Use the app-bundled Intel Node, not Rosetta on an ARM Mac');
  const { stdout: arch } = await execute('/usr/bin/uname', ['-m']);
  assert.equal(arch.trim(), 'x86_64');
  const { stdout: translated } = await execute('/usr/sbin/sysctl', [
    '-in',
    'sysctl.proc_translated',
  ]);
  assert.notEqual(translated.trim(), '1', 'Rosetta is not an Intel test environment');
  const { stdout: system } = await execute('/usr/bin/sw_vers', ['-productVersion']);
  const { stdout: build } = await execute('/usr/bin/sw_vers', ['-buildVersion']);
  assert.match(system.trim(), /^15\./, 'This suite must run on macOS 15');
  return {
    architecture: arch.trim(),
    system: system.trim(),
    build: build.trim(),
    image: process.env.ImageVersion,
  };
}

export async function packagedApp(appPath, driver, dataDir) {
  const app = await realpath(appPath);
  const node = path.join(app, 'Contents/Resources/node/bin/node');
  assert.equal(
    await realpath(process.execPath),
    await realpath(node),
    'Run tests with the app-bundled Node',
  );
  const build = JSON.parse(
    await readFile(path.join(app, 'Contents/Resources/agent-service/build-info.json'), 'utf8'),
  );
  assert.equal(typeof build.buildId, 'string');
  let pid;
  let endpoint;
  const tokens = new Set();

  async function drive(action) {
    const args = [action, app, dataDir];
    if (action !== 'launch') args.push(String(pid));
    const { stdout } = await execute(driver, args, { timeout: 20000 });
    return JSON.parse(stdout);
  }

  async function assertOwnedService(value) {
    const { stdout } = await execute('/bin/ps', ['-ww', '-p', String(value.pid), '-o', 'comm=']);
    assert.equal(
      await realpath(stdout.trim()),
      await realpath(node),
      'Service must use this app’s Node',
    );
    const { stdout: arguments_ } = await execute('/bin/ps', [
      '-ww',
      '-p',
      String(value.pid),
      '-o',
      'args=',
    ]);
    assert.ok(
      arguments_.includes(`--dataDir ${dataDir} `),
      'Service must own this isolated data directory',
    );
  }

  return {
    app,
    tokens,
    buildId: build.buildId,
    get endpoint() {
      return endpoint;
    },
    get pid() {
      return pid;
    },
    async launch() {
      const launched = await drive('launch');
      pid = launched.pid;
      assert.equal(launched.x86_64, true);
      endpoint = await until('app publishes its service endpoint', async () => {
        const state = await drive('inspect');
        assert.equal(state.running, true, 'App exited during startup');
        return readEndpoint(dataDir);
      });
      tokens.add(endpoint.token);
      assert.equal(endpoint.buildId, build.buildId, 'Service must match the packaged build');
      await assertOwnedService(endpoint);
      const api = serviceClient(endpoint);
      const status = await api.request('/v1/status');
      assert.equal(status.service.serviceId, endpoint.serviceId);
      const window = await until('app has a visible window', async () => {
        const state = await drive('inspect');
        assert.equal(state.running, true);
        return state.finishedLaunching && state.visibleWindows > 0 ? state : null;
      });
      return { api, window };
    },
    async quit() {
      assert.ok(pid && endpoint);
      assert.equal(
        (await drive('quit')).quitRequested,
        true,
        'App must still be running for normal quit',
      );
      await until('normal app exit', () => !alive(pid), 35000);
      await until('owned service exits with app', () => !alive(endpoint.pid));
      assert.equal(await readEndpoint(dataDir), null, 'Shutdown must remove endpoint.json');
      pid = undefined;
      endpoint = undefined;
    },
    async cleanup() {
      // Recover ownership even when launch timed out after LaunchServices accepted it.
      if (!pid) {
        try {
          pid = Number(await readFile(path.join(dataDir, 'smoke-app.pid'), 'utf8'));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      if (!endpoint && pid) endpoint = await readEndpoint(dataDir);
      if (endpoint) tokens.add(endpoint.token);
      if (pid && alive(pid)) {
        // The driver may report a missing app; do not signal a reused non-application PID.
        assert.equal((await drive('inspect')).running, true);
        process.kill(pid, 'SIGTERM');
        try {
          await until('cleanup app exit', () => !alive(pid), 35000);
        } catch {
          assert.equal((await drive('inspect')).running, true);
          process.kill(pid, 'SIGKILL');
        }
      }
      if (endpoint && alive(endpoint.pid)) {
        await assertOwnedService(endpoint);
        process.kill(endpoint.pid, 'SIGTERM');
        try {
          await until('cleanup service exit', () => !alive(endpoint.pid), 5000);
        } catch {
          await assertOwnedService(endpoint);
          process.kill(endpoint.pid, 'SIGKILL');
        }
      }
    },
  };
}
