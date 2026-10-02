import { readFile, rm } from 'node:fs/promises';
import type { PluginRunSnapshot } from '@atd/plugin-kit';
import { atomicWrite } from '../config.js';
import { PluginHost, pluginHostPath, type PluginView } from './host.js';
import { collectRenderedSkills, renderedHashes } from './rendered.js';
import { pluginSkillSet, type PluginSkillSet } from './skill-set.js';

/**
 * What a run froze of the plugin catalog (D4): the effective items by kind, host and installed,
 * and the installed revisions they come from. Written once at accept beside the run's other
 * freezes, read when the run binds MCP, and removed at release, which also drops the run's
 * revision references so superseded revisions can be collected. `rendered` names the rendered
 * skill bodies (plugins/rendered.ts) the run's skill catalog points at, kept until release.
 */
interface RunFile {
  version: 1;
  runId: string;
  frozenAt: string;
  snapshot: PluginRunSnapshot;
  rendered: string[];
}

function runFile(dataDir: string, runId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(runId)) throw new Error('Invalid run id.');
  return pluginHostPath(dataDir, 'runs', `${runId}.json`);
}

/** The frozen snapshot of `runId`, or null for a run frozen before plugins existed. */
export async function loadRunPluginSnapshot(
  dataDir: string,
  runId: string,
): Promise<PluginRunSnapshot | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(runFile(dataDir, runId), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return null;
    const snapshot = Reflect.get(raw, 'snapshot') as PluginRunSnapshot | undefined;
    return snapshot && typeof snapshot.items === 'object' ? snapshot : null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw new Error('A run plugin snapshot could not be read. The original file is preserved.');
  }
}

/**
 * Freezes the plugin catalog for `runId` once: a repeat returns the first snapshot. Answers the
 * view it was taken from and the run's plugin skill set, mapped from the same read.
 */
export async function freezeRunPlugins(
  dataDir: string,
  runId: string,
): Promise<{
  host: PluginHost;
  view: PluginView;
  snapshot: PluginRunSnapshot;
  skills: PluginSkillSet;
}> {
  const host = await PluginHost.for(dataDir);
  const view = await host.view();
  const snapshot = (await loadRunPluginSnapshot(dataDir, runId)) ?? PluginHost.runSnapshot(view);
  const skills = await pluginSkillSet(host, view, snapshot);
  const file: RunFile = {
    version: 1,
    runId,
    frozenAt: new Date().toISOString(),
    snapshot,
    rendered: renderedHashes(host, skills.records),
  };
  await atomicWrite(runFile(dataDir, runId), file);
  await host.installer.retain(runId, snapshot);
  return { host, view, snapshot, skills };
}

/**
 * Releases the run's revision references, removes its snapshot, and collects rendered skill
 * bodies nothing references any more.
 */
export async function releaseRunPlugins(dataDir: string, runId: string): Promise<void> {
  const host = await PluginHost.for(dataDir);
  await host.installer.release(runId);
  await rm(runFile(dataDir, runId), { force: true });
  await collectRenderedSkills(host);
}
