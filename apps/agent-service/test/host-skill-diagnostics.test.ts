import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { discoverAtdSkills } from '../dist/skills/atd-skills.js';
import { userAgentsSkillsDir } from '../dist/skills/user-agents.js';
import { hostSkillDiagnostics } from '../dist/plugins/host-skill-diagnostics.js';

test('invalid Personal skill remains diagnosable, does not hide valid skills, and recovers', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'host-skill-diagnostics-'));
  const previous = process.env.AI_ATD_HOME;
  process.env.AI_ATD_HOME = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.AI_ATD_HOME;
    else process.env.AI_ATD_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });
  const skillFile = (name: string) => path.join(root, 'skills', name, 'SKILL.md');
  const save = async (name: string, body: string) => {
    await mkdir(path.dirname(skillFile(name)), { recursive: true });
    await writeFile(skillFile(name), body);
  };
  await save('broken', '---\nname: [bad\n---\nFixture\n');
  await save('valid', '---\nname: valid\ndescription: Synthetic fixture\n---\nReply briefly.\n');
  const before = await discoverAtdSkills();
  assert.ok(before.skills.some((skill) => skill.name === 'valid'));
  assert.ok(!before.skills.some((skill) => skill.name === 'broken'));
  const broken = before.diagnostics.find((diagnostic) => diagnostic.path === skillFile('broken'));
  assert.ok(broken, 'loader errors must survive discovery even without a loaded skill');
  const catalogs = hostSkillDiagnostics(
    [
      ...before.diagnostics,
      { type: 'error', code: 'invalid_skill', message: 'Builtin fixture', skill: 'create-skill' },
    ],
    [
      {
        type: 'warning',
        code: 'invalid_skill',
        message: 'Shared fixture',
        path: path.join(userAgentsSkillsDir(), 'shared-broken', 'SKILL.md'),
      },
    ],
  );
  assert.ok(catalogs.get('user')?.some((diagnostic) => diagnostic.path === 'broken/SKILL.md'));
  assert.equal(catalogs.get('builtin:core')?.[0]?.message, 'Builtin fixture');
  assert.equal(catalogs.get('shared:agents-skills')?.[0]?.path, 'shared-broken/SKILL.md');

  await save('broken', '---\nname: broken\ndescription: Repaired fixture\n---\nReply briefly.\n');
  const after = await discoverAtdSkills();
  assert.ok(after.skills.some((skill) => skill.name === 'broken'));
  assert.ok(!after.diagnostics.some((diagnostic) => diagnostic.path === skillFile('broken')));
});
