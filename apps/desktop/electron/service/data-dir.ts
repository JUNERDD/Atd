import { homedir, platform } from 'node:os';
import path from 'node:path';

/**
 * Where the agent service keeps its data. Free of Electron so the dev server (`vite.config.ts`)
 * finds the same service the desktop app starts.
 */
export function defaultServiceDataDir(): string {
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'AgentService');
    case 'win32':
      return path.join(process.env.LOCALAPPDATA ?? home, 'AgentService');
    default:
      return path.join(
        process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'),
        'agent-service',
      );
  }
}

/**
 * Resolves the service dataDir: an explicit AI_AGENT_DATA_DIR override wins; isolated test
 * profiles (AI_TEST_USER_DATA, which main also uses as its userData) keep the service inside the
 * profile; otherwise the per-OS production default applies.
 */
export function resolveServiceDataDir(): string {
  const override = process.env.AI_AGENT_DATA_DIR?.trim();
  if (override) return override;
  const profile = process.env.AI_TEST_USER_DATA;
  if (profile) return path.join(profile, 'AgentService');
  return defaultServiceDataDir();
}
