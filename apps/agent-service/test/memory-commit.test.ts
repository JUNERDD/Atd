import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { LearnerOp } from '../dist/memory/engine-types.js';
import { openMemory, rootScope, unitInput } from './memory-store-kit.ts';

/** Learner commits: what applies, what waits for the user, and what accepting a suggestion does. */

let atdHome = '';
before(async () => {
  atdHome = await mkdtemp(path.join(tmpdir(), 'memory-atd-'));
  process.env.AI_ATD_HOME = atdHome;
});
after(async () => {
  await rm(atdHome, { recursive: true, force: true });
});

/** A commit whose review saw the seeded units' bodies (memory-commit-guards covers the rest). */
const commit = (
  kit: Awaited<ReturnType<typeof openMemory>>,
  ops: LearnerOp[],
  scope = rootScope(),
  version = kit.memory.currentPolicyVersion(),
) => kit.memory.commitLearned(ops, scope, version, 'correction', new Set(['shell', 'name']));

async function seeded() {
  const kit = await openMemory();
  const { unit: shell } = await kit.memory.create(
    unitInput('Shell', 'Use zsh.', 'memory', { name: 'shell' }),
  );
  const { unit: name } = await kit.memory.create(
    unitInput('Name', 'Called Sam.', 'user', { name: 'name' }),
  );
  return { kit, shell, name };
}

const STALE = { name: 'ConflictError', message: 'This memory changed. Reload it before editing.' };

const skillOp: LearnerOp = {
  op: 'propose_skill',
  name: 'Release Checklist',
  description: 'Steps to cut a release of the desktop app.',
  body: '## When to use\nCutting a release.\n\n## Procedure\n1. Bump the version.\n2. Tag.',
  reason: 'The user walked through the release twice.',
};

test('creates and updates apply as learned; removals, promotions and skills wait', async () => {
  const { kit, shell, name } = await seeded();
  try {
    const result = await commit(kit, [
      { op: 'create', description: 'Prefers short answers', type: 'user', body: 'Keep it short.' },
      { op: 'update', name: 'shell', body: 'Use fish.' },
      { op: 'remove', name: 'name', reason: 'The user renamed themselves.' },
      { op: 'propose_core', name: 'shell', reason: 'Asked every task.' },
      skillOp,
      { op: 'update', name: 'missing', body: 'x' },
    ]);
    assert.deepEqual([result.applied, result.proposed], [2, 3]);
    assert.deepEqual(result.skipped, ['update "missing": no enabled memory is named "missing"']);

    const units = await kit.memory.units();
    const created = units.find((unit) => unit.name === 'prefers-short-answers');
    assert.ok(created);
    assert.deepEqual(
      [created.source, created.reviewed, created.activation],
      ['learned', false, 'index'],
    );
    assert.deepEqual(created.origin, { taskId: 'task-1', runId: 'run-1', trigger: 'correction' });
    const updated = units.find((unit) => unit.id === shell.id);
    assert.deepEqual(
      [updated?.body, updated?.source, updated?.reviewed],
      ['Use fish.', 'learned', false],
    );
    assert.equal((await readdir(path.join(kit.root, 'history', shell.id))).length, 1);
    assert.ok(
      units.some((unit) => unit.id === name.id),
      'a removal waits for the user',
    );

    const { proposals } = await kit.memory.state();
    assert.deepEqual(
      proposals.map((item) => [item.kind, item.name, item.unitId, item.revision, item.category]),
      [
        ['remove', 'name', name.id, name.revision, null],
        // Made against the shell this same commit rewrote: it carries the written revision.
        ['core', 'shell', shell.id, updated?.revision, null],
        ['skill', 'release-checklist', null, null, null],
      ],
    );
    assert.equal(kit.changes(), 1, 'one commit, one notice');
  } finally {
    await kit.close();
  }
});

test('with Ask before saving on, every op becomes a suggestion', async () => {
  const { kit, shell } = await seeded();
  try {
    await kit.memory.setSettings({ askFirst: true });
    const result = await commit(kit, [
      { op: 'create', description: 'Prefers tabs', type: 'memory', body: 'Indent with tabs.' },
      { op: 'update', name: 'shell', description: 'Login shell', body: 'Use fish.' },
    ]);
    assert.deepEqual([result.applied, result.proposed], [0, 2]);
    assert.equal((await kit.memory.units()).find((unit) => unit.id === shell.id)?.body, 'Use zsh.');
    const { proposals } = await kit.memory.state();
    assert.deepEqual(
      proposals.map((item) => [item.kind, item.name, item.description, item.body]),
      [
        ['create', 'prefers-tabs', 'Prefers tabs', 'Indent with tabs.'],
        ['update', 'shell', 'Login shell', 'Use fish.'],
      ],
    );
  } finally {
    await kit.close();
  }
});

test('nothing is written when the version moved, learning is paused or the run is a child', async () => {
  const { kit } = await seeded();
  try {
    const ops: LearnerOp[] = [{ op: 'create', description: 'Late', type: 'memory', body: 'Late.' }];
    const stale = await commit(kit, ops, rootScope(), kit.memory.currentPolicyVersion() - 1);
    assert.deepEqual(stale, {
      applied: 0,
      proposed: 0,
      skipped: ['create: Memory changed after the learner started.'],
    });
    const fromChild = await commit(kit, ops, rootScope({ executionId: 'child:run-1:x' }));
    assert.equal(fromChild.applied, 0);
    await kit.memory.setSettings({ paused: true });
    const paused = await commit(kit, ops);
    assert.deepEqual(paused.skipped, ['create: Learning is paused in Memory settings.']);
    assert.equal((await kit.memory.units()).length, 2);
    assert.equal(kit.changes(), 0);
  } finally {
    await kit.close();
  }
});

test('learners see only enabled units and fold a repeated create into an update', async () => {
  const { kit, shell } = await seeded();
  try {
    await kit.memory.setEnabled(shell.id, false);
    const result = await commit(kit, [
      { op: 'update', name: 'shell', body: 'Use fish.' },
      { op: 'create', name: 'shell', description: 'Shell', type: 'memory', body: 'Use bash.' },
      { op: 'create', name: 'name', description: 'Name', type: 'user', body: 'Called Alex.' },
      { op: 'create', description: 'Name again', type: 'user', body: 'Called Alex.' },
      { op: 'remove', name: 'name', reason: 'One' },
      { op: 'remove', name: 'name', reason: 'Two' },
    ]);
    assert.deepEqual(result.skipped, [
      'update "shell": no enabled memory is named "shell"',
      'create: it is already remembered',
    ]);
    const units = await kit.memory.units();
    assert.equal(units.find((unit) => unit.id === shell.id)?.body, 'Use zsh.', 'never touched');
    assert.equal(units.find((unit) => unit.name === 'shell-2')?.body, 'Use bash.');
    assert.equal(units.find((unit) => unit.name === 'name')?.body, 'Called Alex.');
    const { proposals } = await kit.memory.state();
    assert.deepEqual(
      proposals.map((item) => [item.kind, item.reason]),
      [['remove', 'Two']],
    );
  } finally {
    await kit.close();
  }
});

test('accepting suggestions applies them; dismissing drops them', async () => {
  const { kit, shell, name } = await seeded();
  try {
    await commit(kit, [
      { op: 'propose_core', name: 'shell', reason: 'Used every task.' },
      { op: 'remove', name: 'name', reason: 'Outdated.' },
      skillOp,
      { ...skillOp, name: 'create-skill' },
    ]);
    const pending = async () => (await kit.memory.state()).proposals;
    const id = async (kind: string, unit: string) => {
      const found = (await pending()).find((item) => item.kind === kind && item.name === unit);
      assert.ok(found, `${kind} ${unit}`);
      return found.id;
    };

    const core = await kit.memory.acceptProposal(await id('core', 'shell'));
    assert.equal(core.skill, null);
    assert.equal(
      (await kit.memory.units()).find((unit) => unit.id === shell.id)?.activation,
      'core',
    );
    await kit.memory.acceptProposal(await id('remove', 'name'));
    assert.ok(!(await kit.memory.units()).some((unit) => unit.id === name.id));

    const skill = await kit.memory.acceptProposal(await id('skill', 'release-checklist'));
    assert.deepEqual(skill.skill, { name: 'release-checklist' });
    const text = await readFile(
      path.join(atdHome, 'skills', 'release-checklist', 'SKILL.md'),
      'utf8',
    );
    assert.equal(
      text,
      `---\nname: "release-checklist"\ndescription: "${skillOp.description}"\n---\n\n${skillOp.body}\n`,
    );
    const builtin = await id('skill', 'create-skill');
    await assert.rejects(kit.memory.acceptProposal(builtin), {
      name: 'ConflictError',
      message: /built-in skill/,
    });
    assert.ok(
      (await pending()).some((item) => item.id === builtin),
      'a refused suggestion stays',
    );
    await kit.memory.dismissProposal(builtin);
    assert.deepEqual(await pending(), []);
    await assert.rejects(kit.memory.dismissProposal(builtin), { name: 'ConflictError' });

    await commit(kit, [skillOp]);
    await assert.rejects(kit.memory.acceptProposal(await id('skill', 'release-checklist')), {
      name: 'ConflictError',
      message: /already exists/,
    });
    assert.equal(kit.changes(), 2, 'accepting is a route write; only the commits notify');
  } finally {
    await kit.close();
  }
});

test('accepted creates and updates are learned but reviewed; stale ones conflict', async () => {
  const { kit, shell } = await seeded();
  try {
    await kit.memory.setSettings({ askFirst: true });
    await commit(kit, [
      { op: 'create', name: 'shell', description: 'Other', type: 'user', body: 'Different type.' },
      { op: 'update', name: 'shell', body: 'Use fish.' },
      { op: 'propose_core', name: 'name', reason: 'Always relevant.' },
    ]);
    const [create, update, core] = (await kit.memory.state()).proposals;
    assert.ok(create && update && core);
    await kit.memory.acceptProposal(create.id);
    const made = (await kit.memory.units()).find((unit) => unit.name === 'shell-2');
    assert.deepEqual([made?.type, made?.source, made?.reviewed], ['user', 'learned', true]);
    await kit.memory.acceptProposal(update.id);
    const changed = (await kit.memory.units()).find((unit) => unit.id === shell.id);
    assert.deepEqual([changed?.body, changed?.reviewed], ['Use fish.', true]);

    const nameUnit = (await kit.memory.units()).find((unit) => unit.name === 'name');
    assert.ok(nameUnit);
    // Removed outside the service: only accepting finds out.
    await rm(path.join(kit.root, 'units', nameUnit.id), { recursive: true });
    await assert.rejects(kit.memory.acceptProposal(core.id), {
      name: 'ConflictError',
      message: /no longer exists/,
    });
  } finally {
    await kit.close();
  }
});

test('deleting a unit drops the suggestions about it', async () => {
  const { kit, name } = await seeded();
  try {
    await commit(kit, [
      { op: 'propose_core', name: 'shell', reason: 'Often.' },
      { op: 'remove', name: 'shell', reason: 'Stale.' },
      { op: 'propose_core', name: 'name', reason: 'Always.' },
    ]);
    const removal = (await kit.memory.state()).proposals.find((item) => item.kind === 'remove');
    assert.ok(removal);
    await kit.memory.acceptProposal(removal.id);
    assert.deepEqual(
      (await kit.memory.state()).proposals.map((item) => item.unitId),
      [name.id],
    );
    await kit.memory.delete(name.id);
    assert.deepEqual((await kit.memory.state()).proposals, []);
  } finally {
    await kit.close();
  }
});

test('a suggestion keeps its category and refuses a unit changed since it was made', async () => {
  const { kit, shell } = await seeded();
  try {
    await kit.memory.setSettings({ askFirst: true });
    await commit(kit, [
      {
        op: 'create',
        description: 'Wrong flag',
        type: 'failure',
        category: 'correction',
        body: 'Never pass --force to the deploy script.',
      },
      { op: 'update', name: 'shell', body: 'Use fish.' },
      { op: 'remove', name: 'shell', reason: 'Outdated.' },
    ]);
    const [create, update, removal] = (await kit.memory.state()).proposals;
    assert.ok(create && update && removal);
    assert.deepEqual(
      [create.category, create.revision, update.revision, removal.revision],
      ['correction', null, shell.revision, shell.revision],
    );
    await kit.memory.acceptProposal(create.id);
    const made = (await kit.memory.units()).find((unit) => unit.name === 'wrong-flag');
    assert.deepEqual([made?.type, made?.category], ['failure', 'correction']);

    await kit.memory.save({ id: shell.id, revision: shell.revision, body: 'Use nushell.' });
    for (const stale of [update, removal])
      await assert.rejects(kit.memory.acceptProposal(stale.id), STALE);
    assert.deepEqual(
      (await kit.memory.state()).proposals.map((item) => item.id),
      [update.id, removal.id],
      'refused suggestions stay pending',
    );
    const current = (await kit.memory.units()).find((unit) => unit.id === shell.id);
    assert.equal(current?.body, 'Use nushell.', 'the newer version is kept');
  } finally {
    await kit.close();
  }
});
