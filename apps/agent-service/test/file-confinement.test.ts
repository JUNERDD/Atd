import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { confined, confinedWrite } from '../dist/service-fs.js';
import { checkChildPath } from '../dist/subagents/intersection.js';

/**
 * The agent's file tools (and a subagent's) never write the service's security state or the plugin
 * store, whatever the task's working directory: approvals and installed plugin code change only
 * through the service's own routes.
 */

const temporary: string[] = [];
after(async () => {
  for (const dir of temporary) await rm(dir, { recursive: true, force: true });
});

test('file tools never write the approval store or the plugin store', async () => {
  // tmpdir is a symlink on macOS (/var → /private/var), so both spellings are exercised.
  const dataDir = await mkdtemp(path.join(tmpdir(), 'launch-confine-'));
  temporary.push(dataDir);
  const realData = await realpath(dataDir);
  await mkdir(path.join(dataDir, 'security'), { recursive: true });
  await mkdir(path.join(dataDir, 'plugins'), { recursive: true });
  const link = path.join(await mkdtemp(path.join(tmpdir(), 'launch-link-')), 'data');
  temporary.push(path.dirname(link));
  await symlink(realData, link);
  const blocked = [
    path.join(dataDir, 'security', 'launch-approvals.json'),
    path.join(realData, 'security', 'new', 'file.json'),
    path.join(link, 'plugins', 'state.json'),
    path.join(dataDir, 'plugins', 'revisions', 'kit', 'server.js'),
    ...(process.platform === 'darwin' ? [path.join(dataDir, 'SECURITY', 'x.json')] : []),
  ];
  // The worst case: a task whose working directory is the data dir itself.
  for (const cwd of [dataDir, path.join(dataDir, 'tasks', 't1')]) {
    const relative = path.relative(cwd, path.join(dataDir, 'security', 'launch-approvals.json'));
    for (const target of [...blocked, relative]) {
      await assert.rejects(confinedWrite(cwd, dataDir, target), /blocked/, `${cwd} → ${target}`);
      await assert.rejects(
        checkChildPath({ cwd, dataDir, rawPath: target, write: true }),
        /blocked/,
        `child ${target}`,
      );
    }
  }
  const allowed = await confinedWrite(dataDir, dataDir, 'tasks/t1/notes.md');
  assert.equal(allowed.location, 'inside');
  const readable = await confined(dataDir, dataDir, 'security/launch-approvals.json');
  assert.equal(readable.location, 'inside', 'reading is not a write');
});
