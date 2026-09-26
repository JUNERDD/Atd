import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from '../config.js';

/**
 * Which catalog subagents later runs may register, kept in the service data dir beside the skill
 * harness (skills/harness.ts). Names are catalog names: `service.*` for the system agents and the
 * bare file name for `~/.atd/agents` specialists. Agent files are never written.
 */
interface AgentHarnessFile {
  version: 1;
  disabled: string[];
}

function harnessFile(root: string): string {
  return path.join(root, 'agent-harness.json');
}

async function readHarness(root: string): Promise<AgentHarnessFile> {
  const file = harnessFile(root);
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return { version: 1, disabled: [] };
    const version = Reflect.get(parsed, 'version');
    const disabled = Reflect.get(parsed, 'disabled');
    if (version !== 1 || !Array.isArray(disabled)) return { version: 1, disabled: [] };
    return {
      version: 1,
      disabled: disabled.filter((name): name is string => typeof name === 'string'),
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { version: 1, disabled: [] };
    throw new Error(`Subagent enablement ${file} could not be read. The original file is kept.`);
  }
}

/** Names turned off for later runs. A missing file means every catalog agent is enabled. */
export async function readDisabledAgentNames(root: string): Promise<Set<string>> {
  return new Set((await readHarness(root)).disabled);
}

/** Records enablement for one catalog agent; runs already accepted keep their agents. */
export async function setAgentHarnessEnabled(
  root: string,
  name: string,
  enabled: boolean,
): Promise<void> {
  const disabled = new Set((await readHarness(root)).disabled);
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  await atomicWrite(harnessFile(root), {
    version: 1,
    disabled: [...disabled].sort((a, b) => a.localeCompare(b)),
  });
}
