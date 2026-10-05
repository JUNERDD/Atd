import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { MemoryAuthority } from '../dist/memory/engine.js';
import { openMemory, rootScope, unitInput } from './memory-store-kit.ts';

/** Learning settings, the policy version, who may read or change memory, and change notices. */

const child = rootScope({ executionId: 'child:run-1:reviewer' });
const memoryOff = rootScope({ runMemory: false });

test('settings persist, and only a change bumps the policy version', async () => {
  const kit = await openMemory();
  try {
    assert.deepEqual(await kit.memory.setSettings({}), {
      paused: false,
      askFirst: false,
      version: 0,
    });
    assert.deepEqual(await kit.memory.setSettings({ paused: true }), {
      paused: true,
      askFirst: false,
      version: 1,
    });
    assert.equal((await kit.memory.setSettings({ paused: true })).version, 1);
    assert.equal((await kit.memory.setSettings({ askFirst: true })).version, 2);
    const file = JSON.parse(await readFile(path.join(kit.root, 'settings.json'), 'utf8'));
    assert.deepEqual(file, { version: 1, paused: true, askFirst: true });
    const reopened = await kit.reopen();
    const state = await reopened.state();
    assert.deepEqual([state.paused, state.askFirst, state.version], [true, true, 0]);
  } finally {
    await kit.close();
  }
});

test('reading needs the run flag; learning also needs a root run and no pause', async () => {
  const kit = await openMemory();
  try {
    const memory = kit.memory;
    assert.equal(memory.canRead(rootScope()), true);
    assert.equal(memory.canRead(child), true);
    assert.equal(memory.canRead(memoryOff), false);
    assert.equal(memory.canLearn(rootScope()), true);
    assert.equal(memory.canLearn(child), false);
    assert.equal(memory.canLearn(memoryOff), false);
    await memory.setSettings({ paused: true });
    assert.equal(memory.canLearn(rootScope()), false);
    assert.equal(memory.canRead(rootScope()), true, 'pausing never stops reads');
  } finally {
    await kit.close();
  }
});

test('tool writes are refused without learning and recorded as the agent with it', async () => {
  const kit = await openMemory();
  const heard: string[] = [];
  const stop = MemoryAuthority.onChanged(kit.agentDir, () => heard.push('changed'));
  try {
    const memory = kit.memory;
    const add = unitInput('Prefers dark mode', 'Use dark themes in examples.');
    await assert.rejects(memory.addFromTool(add, child), /Subagents can read memory/);
    await assert.rejects(memory.addFromTool(add, memoryOff), /turned off for this message/);
    await memory.setSettings({ paused: true });
    await assert.rejects(memory.addFromTool(add, rootScope()), /paused in Memory settings/);
    await memory.setSettings({ paused: false });
    assert.deepEqual(heard, [], 'route writes are announced by the server, not here');

    const unit = await memory.addFromTool({ ...add, name: 'Dark Mode!' }, rootScope());
    assert.deepEqual(
      [unit.name, unit.source, unit.reviewed, unit.activation],
      ['dark-mode', 'agent', true, 'index'],
    );
    assert.deepEqual(unit.origin, { taskId: 'task-1', runId: 'run-1', trigger: 'memory_add' });
    const again = await memory.addFromTool(
      { ...add, name: 'dark-mode', body: 'Other' },
      rootScope(),
    );
    assert.equal(again.name, 'dark-mode-2', 'a tool never fails on a taken name');

    const replaced = await memory.replaceFromTool(
      'dark-mode',
      { body: 'Dark, always.' },
      rootScope(),
    );
    assert.equal(replaced.body, 'Dark, always.');
    assert.equal(replaced.origin?.trigger, 'memory_replace');
    await memory.setEnabled(again.id, false);
    await assert.rejects(
      memory.replaceFromTool('dark-mode-2', { body: 'x' }, rootScope()),
      /No enabled memory is named "dark-mode-2"/,
    );
    await memory.removeFromTool('dark-mode', rootScope());
    assert.deepEqual(
      (await memory.units()).map((item) => item.name),
      ['dark-mode-2'],
    );
    assert.equal(heard.length, 4, 'two adds, one replace and one remove');
    assert.equal(kit.changes(), heard.length);
  } finally {
    stop();
    await kit.close();
  }
});

test('a tool asks for always-on through a suggestion; only the user grants or removes it', async () => {
  const kit = await openMemory();
  try {
    const memory = kit.memory;
    const asked = await memory.addFromTool(
      unitInput('Name', 'Called Sam.', 'user', { activation: 'core' }),
      rootScope(),
    );
    assert.equal(asked.activation, 'index');
    const [suggestion] = (await memory.state()).proposals;
    assert.deepEqual(
      [suggestion?.kind, suggestion?.unitId, suggestion?.reason, suggestion?.origin?.trigger],
      ['core', asked.id, '', 'memory_add'],
    );
    await memory.acceptProposal(suggestion?.id ?? '');
    const kept = await memory.replaceFromTool('name', { activation: 'search' }, rootScope());
    assert.equal(kept.activation, 'core', 'a tool never takes a memory out of every task');

    const { unit: editor } = await memory.create(unitInput('Editor', 'Uses Zed.'));
    const promoted = await memory.replaceFromTool('editor', { activation: 'core' }, rootScope());
    assert.equal(promoted.activation, 'index');
    assert.equal(
      (await memory.replaceFromTool('editor', { activation: 'search' }, rootScope())).activation,
      'search',
      'index and search stay the agent’s to choose',
    );
    const pending = (await memory.state()).proposals;
    assert.deepEqual(
      pending.map((item) => [item.kind, item.unitId, item.origin?.trigger]),
      [['core', editor.id, 'memory_replace']],
    );
    const settings = await memory.create(
      unitInput('Big', 'y'.repeat(600), 'user', { activation: 'core' }),
    );
    assert.equal(settings.unit.activation, 'core', 'Settings are taken as given');
  } finally {
    await kit.close();
  }
});

test('accepting always-on checks the core section as runs render it', async () => {
  const kit = await openMemory();
  try {
    const memory = kit.memory;
    // Four 600-character bodies fit 3,000 by length alone; with their tags a fifth does not.
    for (const letter of ['a', 'b', 'c', 'd'])
      await memory.create(
        unitInput(`Profile ${letter}`, letter.repeat(600), 'user', { activation: 'core' }),
      );
    await memory.addFromTool(
      unitInput('Editor', 'x'.repeat(560), 'user', { name: 'editor', activation: 'core' }),
      rootScope(),
    );
    const [suggestion] = (await memory.state()).proposals;
    assert.ok(suggestion);
    await assert.rejects(memory.acceptProposal(suggestion.id), {
      name: 'ConflictError',
      message: /limited to 3000 characters/,
    });
    assert.deepEqual(
      (await memory.state()).proposals.map((item) => item.id),
      [suggestion.id],
      'a refused accept leaves the suggestion pending',
    );
  } finally {
    await kit.close();
  }
});

test('every write bumps the policy version; a toggle works while learning is paused', async () => {
  const kit = await openMemory();
  try {
    const memory = kit.memory;
    await memory.setSettings({ paused: true });
    const { unit, version } = await memory.create(unitInput('Shell', 'Use zsh.'));
    assert.equal(version, 2);
    assert.equal((await memory.setEnabled(unit.id, false)).version, 3);
    assert.equal((await memory.delete(unit.id)).version, 4);
    assert.equal(memory.currentPolicyVersion(), 4);
  } finally {
    await kit.close();
  }
});
