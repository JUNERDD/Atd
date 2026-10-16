import { existsSync, renameSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SettingsStore } from '../settings/store.js';
import { exists } from './paths.js';
import type { SyncCopy, SyncPlan } from './plan.js';

interface StagedCopy {
  copy: SyncCopy;
  directory: string;
  previous: boolean;
  installed: boolean;
}

/**
 * Stage and back up everything before replacing anything. Renames and in-memory publication
 * then run without an await; a failed rename rolls back in reverse order. Sibling staging keeps
 * each rename on its target volume, including an explicitly relocated Personal home.
 */
export async function commitDevelopmentSync(plan: SyncPlan, settings: SettingsStore) {
  if (!plan.copies.length) return plan.result;
  const parent = path.join(plan.target.dataDir, 'seed-backups');
  await mkdir(parent, { recursive: true });
  const backupDir = await mkdtemp(
    path.join(parent, `${new Date().toISOString().replaceAll(':', '-')}-`),
  );
  const staged: StagedCopy[] = [];
  let keepStaging = false;
  try {
    for (const copy of plan.copies) {
      await mkdir(path.dirname(copy.target), { recursive: true });
      const directory = await mkdtemp(path.join(path.dirname(copy.target), '.atd-sync-'));
      staged.push({ copy, directory, previous: false, installed: false });
      const incoming = path.join(directory, 'incoming');
      if (copy.content.kind === 'json')
        await writeFile(incoming, JSON.stringify(copy.content.value), { mode: 0o600 });
      else if (copy.content.kind === 'copy')
        await cp(copy.content.source, incoming, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      if (await exists(copy.target)) {
        const backup = path.join(backupDir, copy.label);
        await mkdir(path.dirname(backup), { recursive: true });
        await cp(copy.target, backup, { recursive: true, force: false, errorOnExist: true });
      }
    }
    await writeFile(
      path.join(backupDir, 'restore-map.json'),
      JSON.stringify(
        staged.map(({ copy }) => ({
          target: copy.target,
          backup: path.join(backupDir, copy.label),
        })),
        null,
        2,
      ),
      { mode: 0o600 },
    );
    try {
      for (const item of staged) {
        if (existsSync(item.copy.target)) {
          renameSync(item.copy.target, path.join(item.directory, 'previous'));
          item.previous = true;
        }
        if (item.copy.content.kind !== 'remove') {
          renameSync(path.join(item.directory, 'incoming'), item.copy.target);
          item.installed = true;
        }
      }
      if (plan.settings) settings.acceptImported(plan.settings);
    } catch (error) {
      keepStaging = true;
      for (const item of staged.toReversed()) {
        if (item.installed) renameSync(item.copy.target, path.join(item.directory, 'incoming'));
        if (item.previous) renameSync(path.join(item.directory, 'previous'), item.copy.target);
      }
      keepStaging = false;
      throw error;
    }
    return { ...plan.result, backupDir };
  } finally {
    if (!keepStaging)
      await Promise.allSettled(
        staged.map(({ directory }) => rm(directory, { recursive: true, force: true })),
      );
  }
}
