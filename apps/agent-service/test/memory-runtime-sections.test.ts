import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { SystemMessage } from '@earendil-works/pi-ai';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { MemoryUnit } from '@atd/agent-contracts';
import { EMPTY_RUN_MEMORY, freezeRunMemory, type RunMemory } from '../dist/memory/run-memory.js';
import {
  MEMORY_CORE_SECTION,
  MEMORY_INDEX_SECTION,
  MEMORY_POLICY_SECTION,
  sessionMemory,
} from '../dist/memory/session-memory.js';
import { sessionSkillCatalog } from '../dist/skills/session-catalog.js';
import { FakeStore, openSession, unit } from './memory-runtime-kit.ts';

/**
 * A run's memory reaches the model as system prompt sections (memory/session-memory.ts): after
 * the skill catalog, only those with text, and unchanged across the prompts of a session, so the
 * provider's prompt cache holds; a memory change patches only its own section.
 */

const ROOM = 100_000;
const MEMORY_SECTIONS = [MEMORY_POLICY_SECTION, MEMORY_CORE_SECTION, MEMORY_INDEX_SECTION];

let scratch: string;
before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'memory-runtime-sections-'));
});
after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** Freezes `units` for a run with memory on. */
function freeze(units: MemoryUnit[]): Promise<RunMemory> {
  return freezeRunMemory(new FakeStore(units), true, ROOM);
}

/** A session with the skill catalog's section and then the memory sections, as the service. */
function memorySession(memory: () => RunMemory) {
  const catalog = { invocable: [], userOnly: [], text: 'Skills are listed here.' };
  return openSession(scratch, [sessionSkillCatalog(() => catalog), sessionMemory(memory)], []);
}

/** The system messages of a session's context: the leading one, then any patches. */
function systemMessages(manager: SessionManager): SystemMessage[] {
  return manager
    .buildSessionContext()
    .messages.filter((message): message is SystemMessage => message.role === 'system');
}

test('memory sections follow the skill catalog, each only when it has text', async () => {
  const memory = await freeze([
    unit('reply-language', { type: 'user', activation: 'core' }),
    unit('prefers-pnpm'),
  ]);
  const full = await memorySession(() => memory);
  await full.prompt();
  full.session.dispose();
  const [system] = systemMessages(full.manager);
  const names = Object.keys(system?.sections ?? {});
  assert.deepEqual(names.slice(names.indexOf('skill_catalog')), [
    'skill_catalog',
    ...MEMORY_SECTIONS,
  ]);
  assert.equal(
    system?.sections?.[MEMORY_POLICY_SECTION],
    `<memory_policy>\n${memory.policyText}\n</memory_policy>`,
  );
  assert.equal(
    system?.sections?.[MEMORY_CORE_SECTION],
    `<memory_core>\n${memory.coreText}\n</memory_core>`,
  );
  assert.equal(
    system?.sections?.[MEMORY_INDEX_SECTION],
    `<memory_index>\n${memory.indexText}\n</memory_index>`,
  );
  assert.ok(full.sent[0]?.includes(`<memory_core>\n${memory.coreText}\n</memory_core>`));

  const policyOnly = await freeze([unit('search-only', { activation: 'search' })]);
  const quiet = await memorySession(() => policyOnly);
  await quiet.prompt();
  quiet.session.dispose();
  const sections = systemMessages(quiet.manager)[0]?.sections ?? {};
  assert.ok(sections[MEMORY_POLICY_SECTION]);
  assert.equal(sections[MEMORY_CORE_SECTION], undefined);
  assert.equal(sections[MEMORY_INDEX_SECTION], undefined);

  const off = await memorySession(() => EMPTY_RUN_MEMORY);
  await off.prompt();
  off.session.dispose();
  const offNames = Object.keys(systemMessages(off.manager)[0]?.sections ?? {});
  assert.ok(offNames.includes('skill_catalog'));
  assert.deepEqual(
    offNames.filter((name) => name.startsWith('memory_')),
    [],
  );
});

test('unchanged memory keeps the system prompt as sent; a change patches only its section', async () => {
  const units = [
    unit('reply-language', { type: 'user', activation: 'core' }),
    unit('prefers-pnpm'),
  ];
  let memory = await freeze(units);
  const { session, manager, prompt, sent } = await memorySession(() => memory);
  await prompt();
  // The task's next run freezes the same memory again: equal text, nothing to patch.
  memory = await freeze(units.map((item) => ({ ...item, reviewed: false })));
  await prompt();
  assert.equal(systemMessages(manager).length, 1);
  assert.equal(sent[1], sent[0]);

  memory = await freeze([...units, unit('tabs-not-spaces')]);
  await prompt();
  session.dispose();
  const [first, patch, ...rest] = systemMessages(manager);
  assert.ok(first);
  assert.deepEqual(rest, []);
  assert.deepEqual(Object.keys(patch?.sections ?? {}), [MEMORY_INDEX_SECTION]);
  assert.match(patch?.sections?.[MEMORY_INDEX_SECTION] ?? '', /<name>tabs-not-spaces<\/name>/);
  assert.ok(sent[2]?.includes('<name>tabs-not-spaces</name>'));
});
