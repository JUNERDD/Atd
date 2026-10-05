import type { SessionFactoryDeps } from '../pi-session.js';
import type { RunBinding } from '../run-binding.js';
import { SUBAGENT_CHILD_ENTRY } from '@atd/agent-contracts';
import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import { collectPermissionLookups } from '../transcript-blocks.js';
import { fromServiceBranch } from '../transcript.js';
import { registerRuntimeAgents, type RuntimeAgent, type RuntimeAgentDefinition } from './agents.js';
import { childApprovals } from './approvals.js';
import { ensureManagedSubagentConfig } from './config.js';
import {
  nameCollisions,
  preloadConfiguredAgents,
  type NameCollision,
} from './configured-agents.js';
import { enrichMemoryAsync, narrowChildCeiling } from './enrich.js';
import { CHILD_WEB_TOOLS } from './intersection.js';
import {
  guardSubagentCall,
  onSubagentExecutionEnd,
  onSubagentResult,
  type GuardInput,
} from './guard.js';
import {
  registerParent,
  storeHost,
  unregisterParentBySession,
  type ChildModelRuntime,
} from './registry.js';
import { resolveRequiredExtensionPath, REQUIRED_EXTENSION_ID } from './required-extension.js';
import { createTaskAgents, type TaskAgents } from './task-agents.js';
import { withServiceSubagentTool } from './tool-contract.js';
import { subagentToolDescription } from './tool-description.js';
import { installManagedLaunchTrigger } from './trigger.js';

/**
 * T5 parent delegator integration. Reuses the pi-subagents delegator; no
 * custom delegate loop, no Pi loop rewrite. The parent factory composes the
 * upstream extension with service registrations: managed config, required
 * bridge, ceiling and runtime agents. Multi-child calls are pi-subagents' own
 * `tasks` and `chain`. Guards live in guard.ts, async narrowing in enrich.ts,
 * and the session's agent set and ceiling, task agents included, in task-agents.ts.
 */

/** A pi-subagents registration that must be released with its parent session. */
interface Registration {
  dispose(): void;
}

interface Preloaded {
  /** pi-subagents' extension; it registers synchronously, so `assertInstalled` can follow it. */
  subagents: (pi: ExtensionAPI) => void;
  registerRequired(input: {
    sessionId: string;
    extensions: readonly { id: string; path: string }[];
  }): { dispose(): void };
  registerCeiling(input: {
    sessionId: string;
    source: string;
    ceiling: { allowedTools: string[]; allowedAgents: string[] };
  }): {
    dispose(): void;
    update(ceiling: { allowedTools: string[]; allowedAgents: string[] }): void;
  };
  registerAgent(input: { pi: unknown; name: string; definition: RuntimeAgentDefinition }): {
    dispose(): void;
  };
}

/** Preloads delegator seams; fails closed before the parent loader runs. */
async function preload(): Promise<Preloaded> {
  const [main, required, ceiling, agents] = await Promise.all([
    import('pi-subagents'),
    import('pi-subagents/required-child-extensions'),
    import('pi-subagents/capability-ceiling'),
    import('pi-subagents/agents'),
  ]);
  const subagents = (main as { default: Preloaded['subagents'] }).default;
  if (typeof subagents !== 'function') throw new Error('pi-subagents extension is missing.');
  return {
    subagents,
    registerRequired: (
      required as unknown as {
        registerRequiredChildExtensions: Preloaded['registerRequired'];
      }
    ).registerRequiredChildExtensions,
    registerCeiling: (
      ceiling as unknown as {
        registerSubagentCapabilityCeiling: Preloaded['registerCeiling'];
      }
    ).registerSubagentCapabilityCeiling,
    registerAgent: (agents as unknown as { registerAgent: Preloaded['registerAgent'] })
      .registerAgent,
  };
}

/**
 * What a parent takes from its session's run binding, both fixed per session: the runtime agents
 * the session registers when it starts (the service agents enabled at freeze and every enabled
 * catalog agent, Personal and plugin), and the MCP tools its runs bound, which children that keep
 * the task's tools inherit. The task agents the parent defines during the task register beside
 * them (task-agents.ts).
 */
type ParentBinding = Pick<RunBinding, 'agents' | 'mcp'>;

/**
 * Prepares the parent subagent factory. Writes the managed config, pins the
 * agent dir, installs the trigger and validates the bridge path. Returns the
 * single factory pi-session appends to its extension list. `childRuntime` builds a child's model
 * runtime like the session's own, which a runtime change rebuilds the session for.
 */
export async function prepareSubagentsParent(
  deps: SessionFactoryDeps,
  binding: ParentBinding,
  childRuntime: ChildModelRuntime,
): Promise<ExtensionFactory> {
  const agentDir = deps.ctx.paths.agentDir;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  // Ready by session_start, which checks the session's agents against the configured ones.
  preloadConfiguredAgents();
  const { config } = await ensureManagedSubagentConfig(agentDir, deps.ctx.paths.tasksDir);
  deps.audit({ taskId: deps.taskId, subagentsConfig: true, maxDepth: config['maxSubagentDepth'] });
  await installManagedLaunchTrigger();
  const bridgePath = await resolveRequiredExtensionPath();
  deps.audit({ taskId: deps.taskId, requiredExtension: REQUIRED_EXTENSION_ID });
  const preloaded = await preload();
  // Fixed for the session's life, like its agents, so the parent's prompt cache keeps it.
  const description = subagentToolDescription(binding.agents);
  const factory: ExtensionFactory = (host) => {
    // What this session registered at session_start. pi-subagents keys these
    // by session id, and a session rebuilt for a later run reopens the same
    // session file (same id), so shutdown releases them for the next session.
    const registrations: Registration[] = [];
    // The session's agents and ceiling, from its session_start to its shutdown.
    let taskAgents: TaskAgents | null = null;
    // Set at shutdown; a session_start still awaiting then registers nothing it could not release.
    let ended = false;
    // pi-subagents keys runtime agents by the `pi` it was given, so every registration below goes
    // through the same view that carries the service's subagent tool contract.
    const { api: pi, assertInstalled } = withServiceSubagentTool(host, {
      description,
      define: async (toolCallId, agents) => {
        if (!taskAgents) throw new Error('Task agents are unavailable in this session.');
        return taskAgents.define(toolCallId, agents);
      },
    });
    preloaded.subagents(pi);
    assertInstalled();
    pi.on('tool_call', (raw) => guardSubagentCall(deps, raw as unknown as GuardInput));
    pi.on('tool_result', (raw) => {
      onSubagentResult(deps, raw);
      return undefined;
    });
    pi.on('tool_execution_end', (raw) => onSubagentExecutionEnd(deps, raw));
    pi.on('session_start', async (_raw, ctxRaw) => {
      const ctx = ctxRaw as unknown as {
        sessionManager: { getSessionId(): string | undefined };
        cwd: string;
      };
      const configured = await nameCollisions(ctx.cwd);
      if (ended) return undefined;
      const started = registerParentSession(deps, preloaded, bridgePath, pi, ctx, {
        binding,
        registrations,
        childRuntime,
        configured,
      });
      taskAgents = started.taskAgents;
      // Pi awaits this before the run's first turn: task agents replay against the narrowed
      // child tools, which every define then validates against too.
      await narrowChildCeiling(
        deps,
        deps.taskId,
        started.runId,
        started.taskAgents,
        binding.mcp.tools,
      );
      started.taskAgents.replay(configured.collision);
      void enrichMemoryAsync(deps, deps.taskId, started.runId);
      return undefined;
    });
    // session-rewind.ts tells extensions when a run rewinds the branch of a live session.
    pi.on('session_tree', () => {
      taskAgents?.followBranch();
      return undefined;
    });
    pi.on('session_shutdown', (_raw, ctxRaw) => {
      ended = true;
      taskAgents = null;
      for (const registration of registrations.splice(0)) registration.dispose();
      const ctx = ctxRaw as unknown as { sessionManager: { getSessionId(): string | undefined } };
      const sessionId = ctx.sessionManager.getSessionId();
      if (sessionId) {
        unregisterParentBySession(sessionId);
      }
      return undefined;
    });
  };
  return factory;
}

/**
 * The sync part of a parent's session start: its runtime agents, ceiling, task agents owner,
 * parent record, child host and required bridge. Returns the owner and the run that started it.
 */
function registerParentSession(
  deps: SessionFactoryDeps,
  preloaded: Preloaded,
  bridgePath: string,
  pi: ExtensionAPI,
  ctx: { sessionManager: { getSessionId(): string | undefined }; cwd: string },
  session: {
    binding: ParentBinding;
    registrations: Registration[];
    childRuntime: ChildModelRuntime;
    /** The session start's check against the configured agents (configured-agents.ts). */
    configured: { collision: NameCollision; error: string | null };
  },
): { taskAgents: TaskAgents; runId: string } {
  const { binding, registrations } = session;
  const sessionId = ctx.sessionManager.getSessionId();
  if (!sessionId) throw new Error('Subagent parent has no session identity; refusing to start.');
  // Pi hands extensions its live SessionManager behind a read-only type; child approvals,
  // `app-child` and `app-agent` entries are written to it like the parent's own records.
  const sessions = ctx.sessionManager;
  if (!(sessions instanceof SessionManager))
    throw new Error('Subagent parent has no session manager; refusing to start.');
  const taskId = deps.taskId;
  const runId = deps.currentRunId();
  const run = deps.ctx.ledger.run(taskId, runId);
  const sessionAgents = sessionRuntimeAgents(deps, runId, binding.agents, session.configured);
  // Runtime agents register first: if pi-subagents refuses one, nothing below
  // registers, no parent record exists and the guard blocks every call.
  registrations.push(
    registerRuntimeAgents(pi, sessionAgents, (input) => preloaded.registerAgent(input)),
  );
  // Sync registrations use the frozen run snapshot plus the web tools every parent keeps;
  // enrich.ts narrows async and fails closed to fewer tools (never wider) when unavailable.
  const parentTools = [...run.snapshot.tools];
  const childTools = [...parentTools, ...CHILD_WEB_TOOLS];
  const ceiling = preloaded.registerCeiling({
    sessionId,
    source: 'service',
    ceiling: { allowedTools: childTools, allowedAgents: sessionAgents.map(({ name }) => name) },
  });
  registrations.push(ceiling);
  const taskAgents = createTaskAgents({
    deps,
    sessions,
    cwd: ctx.cwd,
    sessionAgents,
    childTools,
    ceiling,
    register: (name, definition) => preloaded.registerAgent({ pi, name, definition }),
  });
  registrations.push(taskAgents);
  registerParent({
    taskId,
    runId,
    sessionId,
    tools: parentTools,
    roleId: 'default',
    agents: taskAgents,
    appendChildEntry: (entry) => {
      sessions.appendCustomEntry(SUBAGENT_CHILD_ENTRY, entry);
    },
  });
  const approvals = childApprovals(deps, sessions, binding.agents);
  storeHost(taskId, {
    dataDir: deps.ctx.paths.root,
    cwd: ctx.cwd,
    allowedTools: childTools.filter((tool) => tool !== 'ask_user'),
    runMemory: run.snapshot.memory,
    audit: deps.audit,
    resourceIds: run.snapshot.input.files.map((file) => file.id),
    childRuntime: session.childRuntime,
    approvals,
    // The ceiling admits their names once enrich.ts has narrowed it; until then pi drops them.
    mcpBuilder: (child) =>
      binding.mcp.childFactory({
        runId: child.runId,
        executionId: child.executionId,
        tier: approvals(child).tier,
      }),
    publishChildTranscript: (child, data) => {
      deps.ctx.events.publish({
        taskId,
        runId: child.runId,
        executionId: child.executionId,
        type: 'child.transcript.patch',
        data,
      });
    },
    parentPermissions: () => collectPermissionLookups(fromServiceBranch(sessions.getBranch())),
  });
  registrations.push(
    preloaded.registerRequired({
      sessionId,
      extensions: [{ id: REQUIRED_EXTENSION_ID, path: bridgePath }],
    }),
  );
  return { taskAgents, runId };
}

/**
 * The runtime agents a session registers: its binding's, less any whose name a configured agent
 * takes, since pi-subagents would then refuse the session's whole agent set. The managed settings
 * keep task folders out of discovery (config.ts), so only an agent file elsewhere can take one;
 * that agent stays unavailable for the session, audited. When the configured agents cannot be
 * read, every agent registers as before and the audit says so.
 */
function sessionRuntimeAgents(
  deps: SessionFactoryDeps,
  runId: string,
  agents: readonly RuntimeAgent[],
  configured: { collision: NameCollision; error: string | null },
): RuntimeAgent[] {
  const audit = (entry: Record<string, unknown>) =>
    deps.audit({ taskId: deps.taskId, runId, ...entry });
  if (configured.error) {
    audit({ subagentAgentsUnchecked: configured.error });
    return [...agents];
  }
  return agents.filter(({ name }) => {
    const reason = configured.collision(name);
    if (reason)
      audit({ agent: name, decision: 'unavailable', reason: `${reason}; it cannot run here` });
    return !reason;
  });
}
