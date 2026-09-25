import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TODO_TOOL, WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from '@ai/agent-contracts';

/**
 * T5 managed subagent config (D4). Written to the service profile before the
 * parent loader reads it; Pi and pi-subagents own parsing, the service owns
 * these pinned values. No detach shortcut, no scheduling/missions/intercom.
 */

export const SUBAGENT_LIMITS = {
  namedArgsLimit: 16384,
} as const;

export const SUBAGENT_CONFIG_DIR = 'extensions/subagent';
export const SUBAGENT_CONFIG_FILE = 'config.json';

export const SERVICE_PARALLEL_WORKFLOW = 'service.parallel';
export const SERVICE_CHAIN_WORKFLOW = 'service.chain';

/**
 * Tools a child may never receive: re-delegation, role/config planes, and the parent-only
 * harness tools (todo, web). Harness tools are not snapshot tools, so they never reach a
 * child's parent tools anyway; listing them keeps the ceiling closed if that ever changes.
 */
export const FORBIDDEN_CHILD_TOOLS = [
  'subagent',
  'ask_user',
  'desktop',
  TODO_TOOL,
  WEB_SEARCH_TOOL,
  WEB_FETCH_TOOL,
] as const;

/** Explicit child system prompt; the trigger pins it on every launch. */
export const SUBAGENT_CHILD_SYSTEM_PROMPT =
  'You are a bounded child subagent of the desktop assistant. Complete only the assigned task with the available tools. File paths do not grant access. You cannot delegate further, change roles, or schedule work. Return an explicit result; the parent decides what to use.';

/**
 * Managed config pinned for every parent; unknown keys are never added. Child concurrency keeps
 * pi-subagents' own bounds: its default global child limit and per-run fan-out budget.
 */
export function managedSubagentConfig(): Record<string, unknown> {
  return {
    asyncByDefault: false,
    forceTopLevelAsync: false,
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

/**
 * Pi settings pinned in the service agent dir. pi-subagents reads its agent
 * discovery switches from the `subagents` key here, not from the extension
 * config. Its packaged builtins (`scout`, `worker`, the external CLI runners…)
 * are refused by the ceiling anyway, so they stay out of discovery: `list`
 * then advertises only the agents a parent may actually call. The parent
 * session keeps in-memory settings, so only pi-subagents and children read it.
 */
export function managedAgentSettings(): Record<string, unknown> {
  return { subagents: { disableBuiltins: true } };
}

/** Writes the managed config and settings; fails closed when a write does not land. */
export async function ensureManagedSubagentConfig(agentDir: string): Promise<{
  path: string;
  config: Record<string, unknown>;
}> {
  const file = subagentConfigPath(agentDir);
  const config = managedSubagentConfig();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await writeFile(
    path.join(agentDir, 'settings.json'),
    `${JSON.stringify(managedAgentSettings(), null, 2)}\n`,
    'utf8',
  );
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
    maxSubagentDepth: config['maxSubagentDepth'],
    scheduledOff: scheduled?.enabled === false,
    intercomOff: intercom?.mode === 'off',
    missionsOff: missions?.enabled === false,
    detachAbsent: config['foregroundDetachShortcut'] === undefined,
  };
}
