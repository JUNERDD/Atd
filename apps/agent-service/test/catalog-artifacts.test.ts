import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Fastify from 'fastify';
import type { InvalidateFrame } from '@atd/agent-contracts';
import {
  artifactEntryOf,
  catalogArtifactWrite,
  type ArtifactEntry,
} from '../dist/catalog-artifacts.js';
import { registerStoreInvalidation } from '../dist/store-invalidation.js';

test('successful catalog saves invalidate only their profile and stop after server close', async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'catalog-artifacts-')));
  const previous = process.env.AI_ATD_HOME;
  process.env.AI_ATD_HOME = path.join(root, 'product');
  const apps = [Fastify(), Fastify()];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    if (previous === undefined) delete process.env.AI_ATD_HOME;
    else process.env.AI_ATD_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });
  const profiles = [path.join(root, 'a'), path.join(root, 'b')];
  const frames: InvalidateFrame[][] = [[], []];
  for (const [index, app] of apps.entries()) {
    registerStoreInvalidation(
      app,
      { root: profiles[index]!, agentDir: path.join(profiles[index]!, 'agent') },
      (frame) => frames[index]!.push(frame),
    );
    await app.ready();
  }
  const entries: ArtifactEntry[] = [];
  const sink = {
    appendCustomEntry: (kind: string, data?: unknown) => {
      const entry = artifactEntryOf(kind, data);
      assert.ok(entry);
      entries.push(entry);
      return String(entries.length);
    },
  };
  const skill = path.join(process.env.AI_ATD_HOME, 'skills', 'sample', 'SKILL.md');
  await mkdir(path.dirname(skill), { recursive: true });
  const create = await catalogArtifactWrite(skill);
  assert.ok(create);
  assert.deepEqual(frames, [[], []], 'preparing a declined or failed write sends no change');
  assert.equal(await catalogArtifactWrite(path.join(root, 'ordinary.md')), null);
  await writeFile(skill, '---\nname: sample\ndescription: Fixture\n---\nReply with a sample.\n');
  await create.record(sink, 'create', profiles[0]!);
  assert.deepEqual(frames, [[{ type: 'invalidate', scope: 'extensions' }], []]);
  assert.deepEqual(entries[0]?.artifact, {
    kind: 'skill',
    action: 'created',
    id: 'sample',
    name: 'sample',
  });

  const update = await catalogArtifactWrite(skill);
  assert.ok(update);
  await writeFile(skill, '---\nname: sample\ndescription: Updated\n---\nReply with an update.\n');
  await update.record(sink, 'edit', profiles[0]!);
  assert.equal(entries[1]?.artifact.action, 'updated');
  assert.equal(frames[0]?.length, 2);

  const agent = path.join(process.env.AI_ATD_HOME, 'agents', 'specialist.md');
  await mkdir(path.dirname(agent), { recursive: true });
  const saveAgent = await catalogArtifactWrite(agent);
  assert.ok(saveAgent);
  await writeFile(agent, '---\nname: specialist\ndescription: Fixture\n---\nReply briefly.\n');
  await saveAgent.record(sink, 'agent', profiles[0]!);
  assert.equal(entries[2]?.artifact.kind, 'subagent');
  assert.equal(frames[0]?.length, 3);
  assert.equal(frames[1]?.length, 0);

  await apps[0]!.close();
  await update.record(sink, 'after-close', profiles[0]!);
  assert.equal(frames[0]?.length, 3, 'closing the server removes its store subscriptions');
});
