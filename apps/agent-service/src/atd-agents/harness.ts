import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SubagentPermissionsSchema, parse, type SubagentPermissions } from '@ai/agent-contracts';
import { atomicWrite } from '../config.js';

/**
 * What Settings decided about catalog subagents for later runs, kept in the service data dir
 * beside the skill harness (skills/harness.ts): which are turned off, and which carry a
 * permission override (atd-agents/permissions.ts). Names are catalog names: `service.*` for the
 * system agents and the bare file name for `~/.atd/agents` specialists. Agent files are never
 * written. Version 1 files (enablement only) read as version 2 without overrides.
 */
interface AgentHarness {
  disabled: Set<string>;
  permissions: Map<string, SubagentPermissions>;
}

function harnessFile(root: string): string {
  return path.join(root, 'agent-harness.json');
}

function emptyHarness(): AgentHarness {
  return { disabled: new Set(), permissions: new Map() };
}

/** Reads the harness; unknown shapes read as empty and an invalid override is dropped. */
export async function readAgentHarness(root: string): Promise<AgentHarness> {
  const file = harnessFile(root);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return emptyHarness();
    throw new Error(`Subagent settings ${file} could not be read. The original file is kept.`);
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyHarness();
  const version = Reflect.get(parsed, 'version');
  const disabled = Reflect.get(parsed, 'disabled');
  if ((version !== 1 && version !== 2) || !Array.isArray(disabled)) return emptyHarness();
  const harness = emptyHarness();
  for (const name of disabled) if (typeof name === 'string') harness.disabled.add(name);
  const permissions = version === 2 ? Reflect.get(parsed, 'permissions') : null;
  if (typeof permissions === 'object' && permissions !== null)
    for (const [name, value] of Object.entries(permissions)) {
      try {
        harness.permissions.set(name, parse(SubagentPermissionsSchema, value));
      } catch {
        // A hand-edited override that no longer validates leaves the agent on its defaults.
      }
    }
  return harness;
}

async function writeHarness(root: string, harness: AgentHarness): Promise<void> {
  const byName = (a: string, b: string) => a.localeCompare(b);
  await atomicWrite(harnessFile(root), {
    version: 2,
    disabled: [...harness.disabled].sort(byName),
    permissions: Object.fromEntries([...harness.permissions].sort(([a], [b]) => byName(a, b))),
  });
}

/** Names turned off for later runs. A missing file means every catalog agent is enabled. */
export async function readDisabledAgentNames(root: string): Promise<Set<string>> {
  return (await readAgentHarness(root)).disabled;
}

/** Records enablement for one catalog agent; runs already accepted keep their agents. */
export async function setAgentHarnessEnabled(
  root: string,
  name: string,
  enabled: boolean,
): Promise<void> {
  const harness = await readAgentHarness(root);
  if (enabled) harness.disabled.delete(name);
  else harness.disabled.add(name);
  await writeHarness(root, harness);
}

/** Stores or, with null, removes one agent's permission override; accepted runs keep theirs. */
export async function setAgentHarnessPermissions(
  root: string,
  name: string,
  permissions: SubagentPermissions | null,
): Promise<void> {
  const harness = await readAgentHarness(root);
  if (permissions) harness.permissions.set(name, permissions);
  else harness.permissions.delete(name);
  await writeHarness(root, harness);
}

/** Drops everything the harness keeps for one agent, after its file is deleted. */
export async function forgetAgentHarness(root: string, name: string): Promise<void> {
  const harness = await readAgentHarness(root);
  const hadSwitch = harness.disabled.delete(name);
  const hadOverride = harness.permissions.delete(name);
  if (hadSwitch || hadOverride) await writeHarness(root, harness);
}
