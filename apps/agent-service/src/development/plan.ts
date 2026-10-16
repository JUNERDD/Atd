import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { DevelopmentSyncResponse, SettingsResponse } from '@atd/agent-contracts';
import { BUILTIN_SKILLS } from '../builtins/manifest.js';
import { starterMarkerFile } from '../commands/starters.js';
import { CommandStore } from '../commands/store.js';
import { readStoredSettings, type SettingsStore } from '../settings/store.js';
import { defaultDataDir, readServiceId, resolveAtdHome, servicePaths } from '../storage.js';
import { assertCopyable, assertSeparate, exists } from './paths.js';

export interface SyncProfile {
  dataDir: string;
  home: string;
}

export function installedProfile(): SyncProfile {
  const dataDir = defaultDataDir();
  return { dataDir, home: resolveAtdHome({ dataDir }) };
}

export interface SyncCopy {
  label: string;
  target: string;
  content: { kind: 'copy'; source: string } | { kind: 'json'; value: unknown } | { kind: 'remove' };
}

export interface SyncPlan {
  copies: SyncCopy[];
  target: SyncProfile;
  settings: SettingsResponse | null;
  result: DevelopmentSyncResponse;
}

/** Only these four categories participate. The source provider directory and keyring are unread. */
export async function planDevelopmentSync(
  source: SyncProfile,
  target: SyncProfile,
  settings: SettingsStore,
): Promise<SyncPlan> {
  const installed = installedProfile();
  await assertSeparate(
    [source.dataDir, source.home, installed.dataDir, installed.home],
    [target.dataDir, target.home, path.join(target.dataDir, 'seed-backups')],
  );
  if (!(await exists(servicePaths(source.dataDir).serviceFile)))
    throw new TypeError('Open the installed app once before syncing its settings.');
  for (const file of ['service.json', 'settings.json', 'commands.json']) {
    const sourceFile = path.join(source.dataDir, file);
    if (await exists(sourceFile)) await assertCopyable(sourceFile);
  }
  await readServiceId(servicePaths(source.dataDir));
  const copies: SyncCopy[] = [];
  const result: DevelopmentSyncResponse = {
    settings: false,
    commands: 0,
    skills: 0,
    agents: 0,
    backupDir: null,
  };
  const stored = await readStoredSettings(source.dataDir);
  const nextSettings = stored
    ? {
        settings: stored.settings,
        initialized: stored.initialized,
        revision: settings.current().revision + 1,
      }
    : null;
  if (nextSettings) {
    result.settings = true;
    copies.push({
      label: 'settings.json',
      target: path.join(target.dataDir, 'settings.json'),
      content: { kind: 'json', value: { version: 1, ...nextSettings } },
    });
  }
  if (await exists(path.join(source.dataDir, 'commands.json'))) {
    const incoming = await CommandStore.load(source.dataDir);
    const current = await CommandStore.load(target.dataDir);
    // Advance revisions so an editor opened before the import cannot overwrite it with stale data.
    const revisions = new Map(
      current.data.commands.map((command) => [command.id, command.revision]),
    );
    for (const command of incoming.data.commands)
      command.revision = Math.max(command.revision, revisions.get(command.id) ?? 0) + 1;
    result.commands = incoming.data.commands.length;
    copies.push({
      label: 'commands.json',
      target: path.join(target.dataDir, 'commands.json'),
      content: { kind: 'json', value: incoming.data },
    });
    const marker = starterMarkerFile(source.dataDir);
    copies.push({
      label: path.basename(marker),
      target: starterMarkerFile(target.dataDir),
      content: (await exists(marker)) ? { kind: 'copy', source: marker } : { kind: 'remove' },
    });
  }
  const builtins = new Set(BUILTIN_SKILLS.map(({ name }) => name));
  for (const folder of ['skills', 'agents'] as const) {
    const root = path.join(source.home, folder);
    if (!(await exists(root))) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (folder === 'skills' && (!entry.isDirectory() || builtins.has(entry.name))) continue;
      if (folder === 'agents' && (!entry.isFile() || !entry.name.endsWith('.md'))) continue;
      result[folder] += 1;
      copies.push({
        label: `home/${folder}/${entry.name}`,
        target: path.join(target.home, folder, entry.name),
        content: { kind: 'copy', source: path.join(root, entry.name) },
      });
    }
  }
  for (const copy of copies) {
    await assertSeparate(
      [source.dataDir, source.home, installed.dataDir, installed.home],
      [copy.target],
    );
    if (copy.content.kind === 'copy') await assertCopyable(copy.content.source);
    if (await exists(copy.target)) await assertCopyable(copy.target);
  }
  return { copies, target, settings: nextSettings, result };
}
