import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { revisionOf } from '../dist/memory/unit.js';
import { openMemory, unitInput } from './memory-store-kit.ts';

/** The authority's file store: units, revisions, history, trash, problems and outside edits. */

const STALE = { name: 'ConflictError', message: 'This memory changed. Reload it before editing.' };

test('a Settings create writes one MEMORY.md whose digest is the revision', async () => {
  const kit = await openMemory();
  try {
    const { unit, version } = await kit.memory.create(
      unitInput('The user prefers pnpm over npm', 'Install packages with pnpm.'),
    );
    assert.equal(version, 1);
    assert.deepEqual(
      [unit.name, unit.type, unit.activation, unit.enabled, unit.source, unit.reviewed],
      ['user-prefers-pnpm-npm', 'memory', 'index', true, 'user', true],
    );
    assert.equal(unit.origin, null);
    const text = await readFile(path.join(kit.root, 'units', unit.id, 'MEMORY.md'), 'utf8');
    assert.equal(unit.revision, revisionOf(text));
    assert.deepEqual(await kit.memory.units(), [unit]);
    await assert.rejects(
      kit.memory.create(unitInput('Another', 'Text', 'user', { name: 'user-prefers-pnpm-npm' })),
      { name: 'ConflictError', message: /already exists/ },
    );
  } finally {
    await kit.close();
  }
});

test('saves check the revision and keep the replaced content as history', async () => {
  const kit = await openMemory();
  try {
    const { unit } = await kit.memory.create(unitInput('Indentation style', 'Two spaces.'));
    const saved = await kit.memory.save({ id: unit.id, revision: unit.revision, body: 'Tabs.' });
    assert.equal(saved.unit.body, 'Tabs.');
    assert.notEqual(saved.unit.revision, unit.revision);
    await assert.rejects(
      kit.memory.save({ id: unit.id, revision: unit.revision, body: 'x' }),
      STALE,
    );
    await assert.rejects(
      kit.memory.save({ id: randomUUID(), revision: unit.revision, body: 'x' }),
      STALE,
    );
    const history = path.join(kit.root, 'history', unit.id);
    const [kept] = await readdir(history);
    assert.ok(kept);
    assert.match(await readFile(path.join(history, kept), 'utf8'), /Two spaces\./);

    const activation = await kit.memory.save({
      id: unit.id,
      revision: saved.unit.revision,
      activation: 'search',
    });
    assert.equal(activation.unit.activation, 'search');
    assert.equal(activation.unit.updated, saved.unit.updated, 'a setting is not a content edit');
    assert.equal((await readdir(history)).length, 1, 'a setting keeps no history version');

    let current = activation.unit;
    for (let n = 0; n < 22; n += 1)
      current = (await kit.memory.save({ id: unit.id, revision: current.revision, body: `v${n}` }))
        .unit;
    assert.equal((await readdir(history)).length, 20);
  } finally {
    await kit.close();
  }
});

test('a delete moves the unit to the trash, which a later load purges after 30 days', async () => {
  const kit = await openMemory();
  try {
    const { unit } = await kit.memory.create(unitInput('Shell', 'Use zsh.'));
    await kit.memory.save({ id: unit.id, revision: unit.revision, body: 'Use fish.' });
    await kit.memory.delete(unit.id);
    assert.deepEqual(await kit.memory.units(), []);
    const trashed = path.join(kit.root, 'trash', unit.id);
    assert.match(await readFile(path.join(trashed, 'MEMORY.md'), 'utf8'), /Use fish\./);
    await assert.rejects(kit.memory.delete(unit.id), STALE);

    await kit.reopen();
    assert.deepEqual(await readdir(path.join(kit.root, 'trash')), [unit.id], 'kept for now');
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await utimes(trashed, old, old);
    await mkdir(path.join(kit.root, 'units', '.staging', randomUUID()), { recursive: true });
    await kit.reopen();
    assert.deepEqual(await readdir(path.join(kit.root, 'trash')), []);
    assert.deepEqual(await readdir(path.join(kit.root, 'history')), [], 'its history goes too');
    assert.deepEqual(await readdir(path.join(kit.root, 'units')), [], 'staging is cleared');
  } finally {
    await kit.close();
  }
});

test('unreadable files are problems and stay out of the units', async () => {
  const kit = await openMemory();
  try {
    const { unit } = await kit.memory.create(unitInput('Editor', 'Uses Zed.'));
    const units = path.join(kit.root, 'units');
    const broken = randomUUID();
    await mkdir(path.join(units, broken));
    await writeFile(path.join(units, broken, 'MEMORY.md'), '---\nname: [\n---\nbody\n');
    await mkdir(path.join(units, randomUUID()));
    await writeFile(path.join(units, 'notes.txt'), 'stray');
    const copy = randomUUID();
    await mkdir(path.join(units, copy));
    const text = await readFile(path.join(units, unit.id, 'MEMORY.md'), 'utf8');
    const later = text.replace(unit.id, copy).replace(/created: "[^"]+"/, 'created: "2099-01-01"');
    await writeFile(path.join(units, copy, 'MEMORY.md'), later);
    await kit.reopen();

    const state = await kit.memory.state();
    assert.deepEqual(
      state.units.map((item) => item.id),
      [unit.id],
    );
    const messages = state.problems.map(
      (item) => `${path.basename(path.dirname(item.path))} ${item.message}`,
    );
    assert.equal(messages.length, 4, messages.join('\n'));
    assert.ok(messages.some((line) => line.startsWith(broken) && /could not be parsed/.test(line)));
    assert.ok(messages.some((line) => /MEMORY\.md is missing/.test(line)));
    assert.ok(messages.some((line) => /Only memory folders/.test(line)));
    assert.ok(messages.some((line) => line.startsWith(copy) && /already uses the name/.test(line)));
  } finally {
    await kit.close();
  }
});

test('an edit made outside the service is read back within a second', async () => {
  const kit = await openMemory();
  try {
    const { unit } = await kit.memory.create(unitInput('Timezone', 'Europe/Berlin.'));
    const file = path.join(kit.root, 'units', unit.id, 'MEMORY.md');
    assert.equal((await kit.memory.units())[0]?.body, 'Europe/Berlin.');
    const edited = (await readFile(file, 'utf8')).replace('Europe/Berlin.', 'Asia/Shanghai.');
    await writeFile(file, edited);
    await sleep(1100);
    const [read] = await kit.memory.units();
    assert.equal(read?.body, 'Asia/Shanghai.');
    assert.equal(read?.revision, revisionOf(edited));
  } finally {
    await kit.close();
  }
});

test('turned-off units leave runs, apps and search but stay in Settings', async () => {
  const kit = await openMemory();
  try {
    const memory = kit.memory;
    const { unit: user } = await memory.create(unitInput('Name', 'Called Sam.', 'user'));
    const { unit: failure } = await memory.create(
      unitInput('Wrong flag', 'Never pass --force to the deploy script.', 'failure'),
    );
    const { unit: off } = await memory.create(unitInput('Deploy target', 'Deploy to staging.'));
    const { version } = await memory.setEnabled(off.id, false);
    assert.equal((await memory.setEnabled(off.id, false)).version, version, 'no change, no bump');

    const names = (units: { name: string }[]) => units.map((unit) => unit.name);
    assert.deepEqual(names(await memory.units()), ['name', 'deploy-target', 'wrong-flag']);
    assert.deepEqual(names(await memory.enabledUnits()), ['name', 'wrong-flag']);
    assert.deepEqual(await memory.list(), [
      { id: user.id, target: 'user', content: 'Called Sam.' },
      { id: failure.id, target: 'failure', content: 'Never pass --force to the deploy script.' },
    ]);
    assert.equal(await memory.readByName('deploy-target'), null);
    assert.equal((await memory.readByName('wrong-flag'))?.id, failure.id);
    assert.deepEqual(names((await memory.search('deploy', { limit: 10 })).map((hit) => hit.unit)), [
      'wrong-flag',
    ]);
    const state = await memory.state();
    assert.equal(state.units.find((unit) => unit.id === off.id)?.enabled, false);

    await memory.setEnabled(off.id, true);
    assert.deepEqual(names(await memory.enabledUnits()), ['name', 'deploy-target', 'wrong-flag']);
    assert.equal(
      (await memory.markReviewed(off.id)).version,
      state.version + 1,
      'already reviewed',
    );
  } finally {
    await kit.close();
  }
});

test('an unreadable settings or suggestions file is reported instead of disabling memory', async () => {
  const kit = await openMemory();
  try {
    await writeFile(path.join(kit.root, 'proposals.json'), '{"version":1,"proposals":[{}]}');
    await writeFile(path.join(kit.root, 'settings.json'), 'not json');
    const memory = await kit.reopen();
    const files = async () =>
      (await memory.state()).problems.map((item) => path.basename(item.path).replace(/\d+$/, ''));
    const state = await memory.state();
    assert.deepEqual([state.paused, state.proposals], [true, []], 'learning pauses until saved');
    assert.deepEqual(await files(), ['settings.json', 'proposals.json.invalid-']);
    assert.ok((await readdir(kit.root)).some((name) => name.startsWith('proposals.json.invalid-')));

    await memory.setSettings({ paused: false });
    assert.deepEqual(await files(), ['proposals.json.invalid-'], 'saved settings clear theirs');
    const reopened = await kit.reopen();
    const after = await reopened.state();
    assert.deepEqual([after.paused, after.problems], [false, []]);
  } finally {
    await kit.close();
  }
});
