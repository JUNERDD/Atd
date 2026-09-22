import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * T5 managed subagent config (D4). Written to the service profile before the
 * parent loader reads it; Pi and pi-subagents own parsing, the service owns
 * these pinned values. No detach shortcut, no scheduling/missions/intercom.
 */

export const SUBAGENT_LIMITS = {
  maxActiveParents: 2,
  maxForegroundChildren: 3,
  maxWorkflowsPerParent: 1,
  namedArgsLimit: 16384,
} as const;

export const SUBAGENT_CONFIG_DIR = 'extensions/subagent';
export const SUBAGENT_CONFIG_FILE = 'config.json';

export const SERVICE_PARALLEL_WORKFLOW = 'service.parallel';
export const SERVICE_CHAIN_WORKFLOW = 'service.chain';

/** Tools a child may never receive: re-delegation and role/config planes. */
export const FORBIDDEN_CHILD_TOOLS = ['subagent', 'ask_user', 'desktop'] as const;

/** Subagent actions closed in round one; the guard blocks them explicitly. */
export const CLOSED_SUBAGENT_ACTIONS = [
  'stop',
  'resume',
  'steer',
  'dismiss',
  'create',
  'update',
  'delete',
  'eject',
  'disable',
  'enable',
  'reset',
  'refine',
  'grant-spawn-budget',
  'doctor',
  'schedule.create',
  'schedule.list',
  'schedule.show',
  'schedule.history',
  'schedule.pause',
  'schedule.resume',
  'schedule.run',
  'schedule.run-due',
  'schedule.delete',
  'mission.create',
  'mission.list',
  'mission.show',
  'mission.update',
  'mission.resolve-decision',
  'mission.attach-run',
  'mission.close',
  'inspector.open',
  'inspector.command',
  'inspector.status',
  'inspector.close',
  'project.open',
  'project.status',
  'project.close',
  'worktree.discard',
  'worktree.cleanup',
  'lane.status',
  'lane.recordMerge',
  'lane.recordSupersession',
  'watchdog.status',
  'watchdog.check',
  'watchdog.configure',
  'watchdog.recommend-model',
] as const;

/** Params that never reach the delegator; rejected before dispatch. */
export const FORBIDDEN_SUBAGENT_PARAMS = [
  'workflowScript',
  'workflowScriptPath',
  'extensionBindings',
  'globalConcurrencyLimit',
  'maxSubagentSpawnsPerRun',
  'machine',
  'sessionDir',
  'mission',
  'missionId',
  'missionUpdate',
  'missionStatus',
  'missionScope',
  'config',
  'at',
  'every',
  'sessionOnly',
  'overlap',
  'catchUp',
] as const;

/** Explicit child system prompt; the trigger pins it on every launch. */
export const SUBAGENT_CHILD_SYSTEM_PROMPT =
  'You are a bounded child subagent of the desktop assistant. Complete only the assigned task with the available tools. File paths do not grant access. You cannot delegate further, change roles, or schedule work. Return an explicit result; the parent decides what to use.';

/** Managed config pinned for every parent; unknown keys are never added. */
export function managedSubagentConfig(): Record<string, unknown> {
  return {
    asyncByDefault: false,
    forceTopLevelAsync: false,
    globalConcurrencyLimit: SUBAGENT_LIMITS.maxForegroundChildren,
    maxSubagentDepth: 1,
    defaultSubagentContext: 'fresh',
    scheduledRuns: { enabled: false },
    intercomBridge: { mode: 'off' },
    proactiveSkillSubagents: false,
    missions: { enabled: false },
  };
}

export function subagentConfigPath(agentDir: string): string {
  return path.join(agentDir, SUBAGENT_CONFIG_DIR, SUBAGENT_CONFIG_FILE);
}

/** Writes the managed config; fails closed when the write does not land. */
export async function ensureManagedSubagentConfig(agentDir: string): Promise<{
  path: string;
  config: Record<string, unknown>;
}> {
  const file = subagentConfigPath(agentDir);
  const config = managedSubagentConfig();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { path: file, config };
}

/** Reads back the managed config for audit; null when absent/unparseable. */
export async function readManagedSubagentConfig(
  agentDir: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = JSON.parse(await readFile(subagentConfigPath(agentDir), 'utf8')) as unknown;
    return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Audit proof: maxDepth/async/guards as the validator asserts them. */
export function auditManagedConfig(config: Record<string, unknown>): {
  asyncByDefault: unknown;
  forceTopLevelAsync: unknown;
  globalConcurrencyLimit: unknown;
  maxSubagentDepth: unknown;
  scheduledOff: boolean;
  intercomOff: boolean;
  missionsOff: boolean;
  detachAbsent: boolean;
} {
  const scheduled = config['scheduledRuns'] as { enabled?: unknown } | undefined;
  const intercom = config['intercomBridge'] as { mode?: unknown } | undefined;
  const missions = config['missions'] as { enabled?: unknown } | undefined;
  return {
    asyncByDefault: config['asyncByDefault'],
    forceTopLevelAsync: config['forceTopLevelAsync'],
    globalConcurrencyLimit: config['globalConcurrencyLimit'],
    maxSubagentDepth: config['maxSubagentDepth'],
    scheduledOff: scheduled?.enabled === false,
    intercomOff: intercom?.mode === 'off',
    missionsOff: missions?.enabled === false,
    detachAbsent: config['foregroundDetachShortcut'] === undefined,
  };
}
