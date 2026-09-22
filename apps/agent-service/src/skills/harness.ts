import { readFile } from 'node:fs/promises';
import { atomicWrite } from '../config.js';
import type { SkillProfilePaths } from './profile.js';

/**
 * Which catalog skills this harness may use. The file lives in the service
 * profile. Skill directories and SKILL.md files are never written.
 */
interface HarnessFile {
  version: 1;
  disabled: string[];
}

function emptyHarness(): HarnessFile {
  return { version: 1, disabled: [] };
}

async function readHarness(profile: SkillProfilePaths): Promise<HarnessFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(profile.harnessFile, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return emptyHarness();
    const version = Reflect.get(parsed, 'version');
    const disabled = Reflect.get(parsed, 'disabled');
    if (version !== 1 || !Array.isArray(disabled)) return emptyHarness();
    return {
      version: 1,
      disabled: disabled.filter((name): name is string => typeof name === 'string'),
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return emptyHarness();
    throw new Error(
      `Harness enablement ${profile.harnessFile} could not be read. The original file is preserved.`,
    );
  }
}

/** Names turned off for runs. Missing file means every catalog skill is enabled. */
export async function readDisabledSkillNames(profile: SkillProfilePaths): Promise<Set<string>> {
  return new Set((await readHarness(profile)).disabled);
}

/** Records enablement in the service profile only. */
export async function setSkillHarnessEnabled(
  profile: SkillProfilePaths,
  name: string,
  enabled: boolean,
): Promise<void> {
  const file = await readHarness(profile);
  const disabled = new Set(file.disabled);
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  await atomicWrite(profile.harnessFile, {
    version: 1,
    disabled: [...disabled].sort((a, b) => a.localeCompare(b)),
  });
}
