import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import path from 'node:path';

/**
 * Storage layout owned by the service. Paths below are persisted data and stay
 * stable, so existing data dirs keep loading without a rewrite.
 */
export interface ServicePaths {
  root: string;
  serviceFile: string;
  endpointFile: string;
  lockFile: string;
  tokenFile: string;
  ledgerFile: string;
  agentDir: string;
  sessionsDir: string;
  tasksDir: string;
  resourcesDir: string;
  auditDir: string;
}

export function defaultDataDir(): string {
  const home = homedir();
  const os = platform();
  if (os === 'darwin') return path.join(home, 'Library', 'Application Support', 'AgentService');
  if (os === 'win32') return path.join(process.env.LOCALAPPDATA ?? home, 'AgentService');
  // Every other platform follows the XDG base directory layout.
  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'),
    'agent-service',
  );
}

/**
 * Data-dir priority: explicit AI_AGENT_DATA_DIR wins, then the CLI flag, then
 * the platform user-service directory. Never derived from an isolated HOME.
 */
export function resolveDataDir(options: {
  envDir?: string | undefined;
  flagDir?: string | undefined;
}): string {
  const raw = options.envDir?.trim() || options.flagDir?.trim() || defaultDataDir();
  return path.resolve(raw);
}

/** The service identity recorded in `service.json`; fails when it is missing. */
export async function readServiceId(paths: ServicePaths): Promise<string> {
  const raw = JSON.parse(await readFile(paths.serviceFile, 'utf8')) as { serviceId?: unknown };
  if (typeof raw.serviceId !== 'string' || !raw.serviceId)
    throw new Error('Service identity is missing.');
  return raw.serviceId;
}

export function servicePaths(root: string): ServicePaths {
  return {
    root,
    serviceFile: path.join(root, 'service.json'),
    endpointFile: path.join(root, 'endpoint.json'),
    lockFile: path.join(root, 'service.lock'),
    tokenFile: path.join(root, 'auth', 'token'),
    ledgerFile: path.join(root, 'ledger.json'),
    agentDir: path.join(root, 'agent'),
    sessionsDir: path.join(root, 'agent', 'sessions'),
    tasksDir: path.join(root, 'tasks'),
    resourcesDir: path.join(root, 'resources'),
    auditDir: path.join(root, 'audit'),
  };
}

/** TODO-owner T3: hosted skill profile, loader options, role snapshots. */
export interface SkillAuthority {
  readonly owner: 'T3';
}

/** TODO-owner T4: single MCP authority, credential transactions, control facade. */
export interface McpAuthority {
  readonly owner: 'T4';
}

/** TODO-owner T5: subagent delegation limits, required service extension. */
export interface SubagentAuthority {
  readonly owner: 'T5';
}
