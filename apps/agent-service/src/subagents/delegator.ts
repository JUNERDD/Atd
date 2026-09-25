import type { SessionFactoryDeps } from '../pi-session.js';
import { SUBAGENT_CHILD_ENTRY } from '@ai/agent-contracts';
import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import { createGate } from '../harness/gate.js';
import { effectiveTaskTier } from '../tasks/tier.js';
import { collectPermissionLookups } from '../transcript-blocks.js';
import { fromServiceBranch } from '../transcript.js';
import { registerRuntimeAgents, SERVICE_RUNTIME_AGENTS, type RuntimeAgent } from './agents.js';
import {
  SERVICE_CHAIN_WORKFLOW,
  SERVICE_PARALLEL_WORKFLOW,
  ensureManagedSubagentConfig,
} from './config.js';
import { enrichParentAsync } from './enrich.js';
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
  type ChildApprovals,
  type ChildModelRuntime,
} from './registry.js';
import { resolveRequiredExtensionPath, REQUIRED_EXTENSION_ID } from './required-extension.js';
import { withServiceSubagentTool } from './tool-contract.js';
import { installManagedSettingsTrigger } from './trigger.js';
import {
  validateChainArgs,
  validateParallelArgs,
  buildChainScript,
  buildParallelScript,
} from './workflows.js';

/**
 * T5 parent delegator integration. Reuses the pi-subagents delegator; no
 * custom delegate loop, no Pi loop rewrite. The parent factory composes the
 * upstream extension with service registrations: managed config, required
 * bridge, ceiling, named workflows and runtime agents. Guards live in
 * guard.ts, async narrowing in enrich.ts.
 */

/** A pi-subagents registration that must be released with its parent session. */
interface Registration {
  dispose(): void;
}

interface Preloaded {
  subagents: ExtensionFactory;
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
  registerWorkflow(input: {
    sessionId: string;
    definition: {
      name: string;
      version: number;
      resolve: (args: Readonly<Record<string, unknown>>) => { script: string } | { error: string };
    };
  }): { dispose(): void };
  registerAgent(input: { pi: unknown; name: string; definition: Record<string, unknown> }): {
    dispose(): void;
  };
}

/** Preloads delegator seams; fails closed before the parent loader runs. */
async function preload(): Promise<Preloaded> {
  const [main, required, ceiling, workflows, agents] = await Promise.all([
    import('pi-subagents'),
    import('pi-subagents/required-child-extensions'),
    import('pi-subagents/capability-ceiling'),
    import('pi-subagents/workflow-resources'),
    import('pi-subagents/agents'),
  ]);
  const subagents = (main as { default: ExtensionFactory }).default;
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
    registerWorkflow: (
      workflows as unknown as { registerWorkflowResource: Preloaded['registerWorkflow'] }
    ).registerWorkflowResource,
    registerAgent: (agents as unknown as { registerAgent: Preloaded['registerAgent'] })
      .registerAgent,
  };
}

/**
 * Prepares the parent subagent factory. Writes the managed config, pins the
 * agent dir, installs the trigger and validates the bridge path. Returns the
 * single factory pi-session appends to its extension list. `runAgents` are
 * the referenced atd agents the session registers beside the service agents
 * (fixed per session through the run binding); `childRuntime` builds a child's model runtime
 * like the session's own, which a runtime change rebuilds the session for.
 */
export async function prepareSubagentsParent(
  deps: SessionFactoryDeps,
  runAgents: RuntimeAgent[],
  childRuntime: ChildModelRuntime,
): Promise<ExtensionFactory> {
  const agentDir = deps.ctx.paths.agentDir;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const { config } = await ensureManagedSubagentConfig(agentDir);
  deps.audit({ taskId: deps.taskId, subagentsConfig: true, maxDepth: config['maxSubagentDepth'] });
  await installManagedSettingsTrigger();
  const bridgePath = await resolveRequiredExtensionPath();
  deps.audit({ taskId: deps.taskId, requiredExtension: REQUIRED_EXTENSION_ID });
  const preloaded = await preload();
  const factory: ExtensionFactory = (host) => {
    // What this session registered at session_start. pi-subagents keys these
    // by session id, and a session rebuilt for a later run reopens the same
    // session file (same id), so shutdown releases them for the next session.
    const registrations: Registration[] = [];
    // pi-subagents keys runtime agents by the `pi` it was given, so every registration below goes
    // through the same view that carries the service's subagent tool contract.
    const { api: pi, assertInstalled } = withServiceSubagentTool(host);
    preloaded.subagents(pi);
    assertInstalled();
    pi.on('tool_call', (raw) => guardSubagentCall(deps, raw as unknown as GuardInput));
    pi.on('tool_result', (raw) => {
      onSubagentResult(deps, raw);
      return undefined;
    });
    pi.on('tool_execution_end', (raw) => onSubagentExecutionEnd(deps, raw));
    pi.on('session_start', (_raw, ctxRaw) => {
      const ctx = ctxRaw as unknown as {
        sessionManager: { getSessionId(): string | undefined };
        cwd: string;
      };
      registerParentSession(deps, preloaded, bridgePath, pi, ctx, {
        agents: [...SERVICE_RUNTIME_AGENTS, ...runAgents],
        registrations,
        childRuntime,
      });
      return undefined;
    });
    pi.on('session_shutdown', (_raw, ctxRaw) => {
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
 * The parent's approval rules for its children: the task tier the parent session froze (pi-session
 * builds its tool host with the same `effectiveTaskTier`) and one gate per child execution over the
 * parent's confirms, session grants, audit and session entries. Child confirms carry the child's
 * execution id, which the desktop labels as a subtask; while one waits, the parent run shows
 * `awaiting_confirmation`, as for the parent's own confirms.
 */
function childApprovals(
  deps: SessionFactoryDeps,
  sessions: SessionManager,
): (child: { runId: string; executionId: string }) => ChildApprovals {
  const tier = effectiveTaskTier(deps.ctx.ledger, deps.taskId, deps.ctx.tier);
  return (child) => ({
    tier,
    gate: createGate({
      taskId: deps.taskId,
      runId: () => child.runId,
      executionId: () => child.executionId,
      tier,
      grants: deps.grants,
      sessions,
      confirms: deps.ctx.confirms,
      audit: deps.audit,
      setStatus: (status) => deps.setStatus(child.runId, status),
    }),
  });
}

function registerParentSession(
  deps: SessionFactoryDeps,
  preloaded: Preloaded,
  bridgePath: string,
  pi: ExtensionAPI,
  ctx: { sessionManager: { getSessionId(): string | undefined }; cwd: string },
  session: {
    agents: RuntimeAgent[];
    registrations: Registration[];
    childRuntime: ChildModelRuntime;
  },
): void {
  const { registrations } = session;
  const sessionId = ctx.sessionManager.getSessionId();
  if (!sessionId) throw new Error('Subagent parent has no session identity; refusing to start.');
  // Pi hands extensions its live SessionManager behind a read-only type; child approvals and
  // `app-child` entries are written to it like the parent's own records.
  const sessions = ctx.sessionManager;
  if (!(sessions instanceof SessionManager))
    throw new Error('Subagent parent has no session manager; refusing to start.');
  const taskId = deps.taskId;
  const runId = deps.currentRunId();
  const run = deps.ctx.ledger.run(taskId, runId);
  // Runtime agents register first: if pi-subagents refuses one, nothing below
  // registers, no parent record exists and the guard blocks every call.
  registrations.push(
    registerRuntimeAgents(pi, session.agents, (input) =>
      preloaded.registerAgent({
        pi: input.pi,
        name: input.name,
        definition: input.definition as unknown as Record<string, unknown>,
      }),
    ),
  );
  const agents = session.agents.map((agent) => agent.name);
  // Sync registrations use the frozen run snapshot; enrich.ts narrows async
  // and fails closed to fewer tools (never wider) when unavailable.
  const parentTools = [...run.snapshot.tools];
  registerParent({
    taskId,
    runId,
    sessionId,
    tools: parentTools,
    roleId: 'default',
    agents,
    appendChildEntry: (entry) => {
      sessions.appendCustomEntry(SUBAGENT_CHILD_ENTRY, entry);
    },
  });
  storeHost(taskId, {
    dataDir: deps.ctx.paths.root,
    cwd: ctx.cwd,
    allowedTools: parentTools.filter((tool) => tool !== 'ask_user'),
    mcpProxies: [],
    runMemory: run.snapshot.memory,
    audit: deps.audit,
    resourceIds: run.snapshot.input.files.map((file) => file.id),
    childRuntime: session.childRuntime,
    approvals: childApprovals(deps, sessions),
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
  const ceiling = preloaded.registerCeiling({
    sessionId,
    source: 'service',
    ceiling: { allowedTools: parentTools, allowedAgents: agents },
  });
  registrations.push(ceiling);
  registrations.push(
    preloaded.registerWorkflow({
      sessionId,
      definition: {
        name: SERVICE_PARALLEL_WORKFLOW,
        version: 1,
        resolve: (args) => {
          const validated = validateParallelArgs(args);
          if (!validated.ok) return { error: validated.error };
          return { script: buildParallelScript(validated.args) };
        },
      },
    }),
  );
  registrations.push(
    preloaded.registerWorkflow({
      sessionId,
      definition: {
        name: SERVICE_CHAIN_WORKFLOW,
        version: 1,
        resolve: (args) => {
          const validated = validateChainArgs(args);
          if (!validated.ok) return { error: validated.error };
          return { script: buildChainScript(validated.args) };
        },
      },
    }),
  );
  void enrichParentAsync(deps, taskId, runId, ceiling, agents);
}
