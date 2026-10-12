import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { DEFAULT_COMMAND_TYPING, DEFAULT_COMMAND_TYPING_ANIMATION } from '@atd/agent-contracts';
import { SettingsStore } from '../dist/settings/store.js';

/**
 * The typing settings: both start off, the typing animation as never chosen (null), which the first
 * turn-on of the typing effect turns on with it; a choice is kept across loads, and settings files
 * written before the animation existed read it as never chosen.
 */

let root = '';
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'settings-store-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const noShortcutCheck = async () => {};
const settingsFile = () => path.join(root, 'settings.json');

/** Rewrites the stored settings as `edit` returns them, as an older build would have left them. */
async function rewriteStored(edit: (settings: Record<string, unknown>) => Record<string, unknown>) {
  const file = JSON.parse(await readFile(settingsFile(), 'utf8'));
  await writeFile(settingsFile(), JSON.stringify({ ...file, settings: edit(file.settings) }));
}

test('a fresh data directory starts with typing off and its animation never chosen', async () => {
  const store = await SettingsStore.load(root, 'auto');
  assert.equal(store.current().settings.commandTyping, false);
  assert.equal(DEFAULT_COMMAND_TYPING, false);
  assert.equal(store.current().settings.commandTypingAnimation, null);
  // Never chosen reads as off.
  assert.equal(DEFAULT_COMMAND_TYPING_ANIMATION, false);
});

test('the first turn-on of typing turns the never-chosen animation on with it', async () => {
  const store = await SettingsStore.load(root, 'auto');
  const answer = await store.patch({ commandTyping: true }, noShortcutCheck);
  assert.equal(answer.settings.commandTyping, true);
  assert.equal(answer.settings.commandTypingAnimation, true);

  // Afterwards the animation is a choice of its own: typing off and on again leaves it as it is.
  await store.patch({ commandTypingAnimation: false }, noShortcutCheck);
  await store.patch({ commandTyping: false }, noShortcutCheck);
  const again = await store.patch({ commandTyping: true }, noShortcutCheck);
  assert.equal(again.settings.commandTypingAnimation, false);
});

test('an animation the user chose before typing was first turned on stays as chosen', async () => {
  const store = await SettingsStore.load(root, 'auto');
  await store.patch({ commandTypingAnimation: false }, noShortcutCheck);
  const answer = await store.patch({ commandTyping: true }, noShortcutCheck);
  assert.equal(answer.settings.commandTypingAnimation, false);
});

test('a request that chooses the animation with the first turn-on keeps its choice', async () => {
  const store = await SettingsStore.load(root, 'auto');
  const answer = await store.patch(
    { commandTyping: true, commandTypingAnimation: false },
    noShortcutCheck,
  );
  assert.equal(answer.settings.commandTypingAnimation, false);
});

test('patches that leave typing off do not choose the animation', async () => {
  const store = await SettingsStore.load(root, 'auto');
  await store.patch({ language: 'en' }, noShortcutCheck);
  const answer = await store.patch({ commandTyping: false }, noShortcutCheck);
  assert.equal(answer.settings.commandTypingAnimation, null);
});

test('a settings file written before the typing animation existed reads it as never chosen', async () => {
  const store = await SettingsStore.load(root, 'auto');
  await store.patch({ commandTyping: true, commandTypingAnimation: false }, noShortcutCheck);
  await rewriteStored(({ commandTypingAnimation: _removed, ...settings }) => settings);

  const reloaded = await SettingsStore.load(root, 'auto');
  assert.equal(reloaded.current().settings.commandTypingAnimation, null);
  assert.equal(reloaded.current().settings.commandTyping, true, 'the other settings stay');
});

test('a stored value that is not a switch reads as never chosen', async () => {
  const store = await SettingsStore.load(root, 'auto');
  await store.patch({ commandTypingAnimation: false }, noShortcutCheck);
  await rewriteStored((settings) => ({ ...settings, commandTypingAnimation: 'off' }));

  const reloaded = await SettingsStore.load(root, 'auto');
  assert.equal(reloaded.current().settings.commandTypingAnimation, null);
});

test('the typing animation choice is kept across loads', async () => {
  const store = await SettingsStore.load(root, 'auto');
  await store.patch({ commandTypingAnimation: true }, noShortcutCheck);

  const reloaded = await SettingsStore.load(root, 'auto');
  assert.equal(reloaded.current().settings.commandTypingAnimation, true);
  const stored = JSON.parse(await readFile(settingsFile(), 'utf8'));
  assert.equal(stored.settings.commandTypingAnimation, true);
});
