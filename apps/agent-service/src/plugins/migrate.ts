import { cp, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from '../config.js';
import { readDisabledSkillNames, setSkillHarnessEnabled } from '../skills/harness.js';
import { skillProfilePaths } from '../skills/profile.js';
import { listCurrent } from '../skills/versions.js';
import type { PluginHost } from './host.js';
import { HOST_PLUGIN_IDS } from './host-plugins.js';

/** What one migration pass did, kept as its run-once marker. */
interface MigrationMarker {
  version: 1;
  migratedAt: string;
  migrated: { skill: string; pluginId: string }[];
  failed: { skill: string; error: string }[];
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Moves the skills installed through the retired skill-only install route (the latest revision
 * of each name in `skills/revisions.json`) into the plugin registry, once (D2). Each skill folder
 * is copied to `plugin-host/legacy-skills/<name>`, so the local source keeps the skill's name and
 * stays available for a later update, then previewed and installed like any local plugin. The
 * skill was live before, so its plugin is enabled, and a skill the harness had turned off stays
 * off as the plugin's item. As a standalone skill it keeps its bare name (plugin-kit
 * `installedItemName`), so `/skill:<name>` references keep resolving. `revisions.json` is then renamed to `revisions.legacy.json`: it stays
 * as a backup without serving the same skills a second time under their old bare names.
 * A skill that fails is listed in the marker and left in the backup; the pass never repeats.
 */
export async function migrateLegacySkills(host: PluginHost): Promise<void> {
  const marker = host.hostDir('legacy-skills-migrated.json');
  if (await exists(marker)) return;
  const profile = skillProfilePaths(host.dataDir, host.agentDir);
  const records = await listCurrent(profile);
  const disabled = await readDisabledSkillNames(profile);
  const result: MigrationMarker = {
    version: 1,
    migratedAt: new Date().toISOString(),
    migrated: [],
    failed: [],
  };
  for (const record of records) {
    const copy = host.hostDir('legacy-skills', record.name);
    try {
      await rm(copy, { recursive: true, force: true });
      await cp(record.baseDir, copy, { recursive: true });
      const preview = await host.installer.preview({ kind: 'local', path: copy });
      if (HOST_PLUGIN_IDS.includes(preview.plugin.manifest.name))
        throw new Error(`"${preview.plugin.manifest.name}" is reserved for a built-in plugin.`);
      const installed = await host.installer.install(preview.previewId);
      await host.installer.setPluginEnabled(installed.id, true);
      if (disabled.has(record.name)) {
        for (const component of installed.plugin.components)
          await host.installer.setItemEnabled(installed.id, `skill:${component.name}`, false);
        // The plugin item now holds the switch; a harness entry left behind would later turn off
        // any host skill that takes this name.
        await setSkillHarnessEnabled(profile, record.name, true);
      }
      result.migrated.push({ skill: record.name, pluginId: installed.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ skill: record.name, error: message });
      host.log.warn('Legacy skill could not be moved into the plugin registry.', {
        skill: record.name,
        error: message,
      });
    }
  }
  if (await exists(profile.revisionsFile))
    await rename(profile.revisionsFile, path.join(profile.profileDir, 'revisions.legacy.json'));
  await atomicWrite(marker, result);
  if (records.length)
    host.log.info('Legacy installed skills moved into the plugin registry.', {
      migrated: result.migrated.length,
      failed: result.failed.length,
    });
}
