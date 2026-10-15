import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('optional subagent mutation evidence skips Git outside working trees', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atd-subagent-git-'));
  const moduleUrl = new URL(
    './src/runs/shared/mutation-evidence.js',
    import.meta.resolve('pi-subagents'),
  ).href;
  // A separate process keeps the built-in module interception away from other tests. A Git
  // probe is observable even on a developer machine where Git would otherwise succeed.
  const program = `
    import assert from 'node:assert/strict';
    import cp from 'node:child_process';
    import fs from 'node:fs';
    import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    let calls = 0;
    cp.execFileSync = (command) => {
      assert.equal(command, 'git');
      calls += 1;
      return '';
    };
    syncBuiltinESMExports();
    const { snapshotTrackedMutations, collectTrackedMutationEvidence } = await import(
      ${JSON.stringify(moduleUrl)}
    );
    const cwd = fs.realpathSync(process.cwd());
    const plain = snapshotTrackedMutations(cwd);
    assert.equal(typeof plain.unavailable, 'string');
    assert.equal(collectTrackedMutationEvidence(plain).unavailable, plain.unavailable);
    assert.equal(calls, 0, 'Non-repository evidence must not launch Git');

    const nested = path.join(cwd, 'repo', 'nested');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(path.join(cwd, 'repo', '.git'));
    assert.equal(snapshotTrackedMutations(nested).unavailable, undefined);
    assert.equal(calls, 1, 'Nested working-tree directories retain Git evidence');

    const linked = path.join(cwd, 'linked');
    fs.mkdirSync(linked);
    fs.writeFileSync(path.join(linked, '.git'), 'gitdir: ../repo/.git/worktrees/linked');
    assert.equal(snapshotTrackedMutations(linked).unavailable, undefined);
    assert.equal(calls, 2, 'A linked worktree has a .git file');

    process.env.GIT_DIR = path.join(cwd, 'repo', '.git');
    assert.equal(snapshotTrackedMutations(cwd).unavailable, undefined);
    assert.equal(calls, 3, 'Explicit Git routing remains supported');
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
      cwd: root,
      env: { PATH: process.env['PATH'], TMPDIR: root },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
