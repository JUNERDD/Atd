import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SettingsManager } from '@earendil-works/pi-coding-agent';

/**
 * Controlled skill profile. Install roots and the subprocess HOME live under
 * the service dataDir. The catalog additionally reads the real user
 * `~/.agents/skills` through `os.homedir()`, never through the confined HOME.
 * Subprocess env is returned as a value so callers pass it to spawn options
 * without mutating the parent.
 */
export interface SkillProfilePaths {
  /** Service dataDir root (AI_AGENT_DATA_DIR resolution, never from HOME). */
  root: string;
  /** Pi agentDir reused for npm/git managed roots (<root>/agent). */
  agentDir: string;
  /** Skill authority dir (<root>/skills). */
  profileDir: string;
  /** Local imports land here; npm/Git stay in Pi managed roots, same service. */
  localDir: string;
  /** Staging generations for install/update (<profile>/staging/<id>). */
  stagingDir: string;
  /** Immutable revision store (<profile>/revisions.json). */
  revisionsFile: string;
  /** Per-run freezes (<profile>/runs.json). */
  runsFile: string;
  /** Managed role definitions (<profile>/roles.json). */
  rolesFile: string;
  /** Harness enablement only (<profile>/harness.json). Never a skill file. */
  harnessFile: string;
  /** Dedicated subprocess HOME inside the service dir. */
  homeDir: string;
  /** Confined npm prefix/userconfig/globalconfig inside the service dir. */
  npmPrefix: string;
  npmUserconfig: string;
  npmGlobalconfig: string;
  /** Sessions cwd for resource loading (service profile, not business files). */
  loaderCwd: string;
}

export function skillProfilePaths(root: string, agentDir: string): SkillProfilePaths {
  const profileDir = path.join(root, 'skills');
  return {
    root,
    agentDir,
    profileDir,
    localDir: path.join(profileDir, 'local'),
    stagingDir: path.join(profileDir, 'staging'),
    revisionsFile: path.join(profileDir, 'revisions.json'),
    runsFile: path.join(profileDir, 'runs.json'),
    rolesFile: path.join(profileDir, 'roles.json'),
    harnessFile: path.join(profileDir, 'harness.json'),
    homeDir: path.join(profileDir, 'home'),
    npmPrefix: path.join(profileDir, 'npm-prefix'),
    npmUserconfig: path.join(profileDir, 'npmrc'),
    npmGlobalconfig: path.join(profileDir, 'npmrc-global'),
    loaderCwd: path.join(profileDir, 'loader-cwd'),
  };
}

/** Creates the profile dirs and confining npmrc files (idempotent). */
export async function ensureSkillProfile(profile: SkillProfilePaths): Promise<void> {
  for (const dir of [
    profile.profileDir,
    profile.localDir,
    profile.stagingDir,
    profile.homeDir,
    profile.npmPrefix,
    profile.loaderCwd,
    path.join(profile.agentDir, 'npm'),
    path.join(profile.agentDir, 'git'),
  ])
    await mkdir(dir, { recursive: true });
  const rc = `prefix=${profile.npmPrefix}\n`;
  await writeFile(profile.npmUserconfig, rc, 'utf8');
  await writeFile(profile.npmGlobalconfig, rc, 'utf8');
}

/**
 * Dedicated subprocess env. Launcher passes this to skill/npm/git children;
 * the parent process env and the user shell env are never mutated. Windows
 * also confines USERPROFILE; POSIX leaves it unset.
 */
export function controlledSubprocessEnv(profile: SkillProfilePaths): Record<string, string> {
  const env: Record<string, string> = {
    HOME: profile.homeDir,
    PI_CODING_AGENT_DIR: profile.agentDir,
    npm_config_prefix: profile.npmPrefix,
    npm_config_userconfig: profile.npmUserconfig,
    npm_config_globalconfig: profile.npmGlobalconfig,
  };
  if (process.platform === 'win32') env.USERPROFILE = profile.homeDir;
  return env;
}

/**
 * Runs `fn` with confined HOME/npm env scoped to this call. Pi spawns read
 * `process.env` at spawn time, so confinement must be ambient during the Pi
 * call; the previous values are always restored, never leaked.
 */
export async function withConfinedSkillEnv<T>(
  profile: SkillProfilePaths,
  fn: () => Promise<T>,
): Promise<T> {
  const keys = [
    'HOME',
    'PI_CODING_AGENT_DIR',
    'USERPROFILE',
    'npm_config_prefix',
    'npm_config_userconfig',
    'npm_config_globalconfig',
  ] as const;
  const saved = new Map<string, string | undefined>();
  for (const key of keys) saved.set(key, process.env[key]);
  const confined = controlledSubprocessEnv(profile);
  for (const [key, value] of Object.entries(confined)) process.env[key] = value;
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * Managed settings: in-memory service user profile, projectTrusted:false from
 * the first read so task cwd project settings are never trusted. Callers add
 * skill paths explicitly; no exec-dir role overrides are read.
 */
export function createManagedSettings(): SettingsManager {
  return SettingsManager.inMemory(
    {
      retry: { enabled: false },
      defaultThinkingLevel: 'off',
      cacheWarming: 'off',
    },
    { projectTrusted: false },
  );
}
