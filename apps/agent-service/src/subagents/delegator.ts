import type { SessionFactoryDeps } from '../pi-session.js';
import type { CredentialStore } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { registerRuntimeAgents, SERVICE_RUNTIME_AGENTS, type RuntimeAgent } from './agents.js';
import {
  SERVICE_CHAIN_WORKFLOW,
  SERVICE_PARALLEL_WORKFLOW,
  ensureManagedSubagentConfig,
  SUBAGENT_PARALLEL_GUIDELINE,
} from './config.js';
import { enrichParentAsync } from './enrich.js';
import { guardSubagentCall, onSubagentResult, type GuardInput } from './guard.js';
import {
  registerParent,
  storeHost,
  unregisterParentBySession,
} from './registry.js';
import { resolveRequiredExtensionPath, REQUIRED_EXTENSION_ID } from './required-extension.js';
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
 * (fixed per session through the run binding); `credentials` is the store of
 * the session's model runtime, which a runtime change rebuilds the session for.
 */
export async function prepareSubagentsParent(
  deps: SessionFactoryDeps,
  runAgents: RuntimeAgent[],
  credentials: CredentialStore,
): Promise<ExtensionFactory> {
  const agentDir = deps.ctx.paths.agentDir;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const { config } = await ensureManagedSubagentConfig(agentDir);
  deps.audit({ taskId: deps.taskId, subagentsConfig: true, maxDepth: config['maxSubagentDepth'] });
  await installManagedSettingsTrigger();
  const bridgePath = await resolveRequiredExtensionPath();
  deps.audit({ taskId: deps.taskId, requiredExtension: REQUIRED_EXTENSION_ID });
  const preloaded = await preload();
  const factory: ExtensionFactory = (pi) => {
    // What this session registered at session_start. pi-subagents keys these
    // by session id, and a session rebuilt for a later run reopens the same
    // session file (same id), so shutdown releases them for the next session.
    const registrations: Registration[] = [];
    preloaded.subagents(pi);
    // The service's custom system prompt skips Pi's per-tool rules, so the guideline rides on
    // the addendum, and only while the subagent tool is on.
    pi.on('before_agent_start', (event) => {
      const options = event.systemPromptOptions;
      if (!options.selectedTools.includes('subagent')) return undefined;
      if (options.appendSystemPrompt.includes(SUBAGENT_PARALLEL_GUIDELINE)) return undefined;
      options.appendSystemPrompt = [options.appendSystemPrompt, SUBAGENT_PARALLEL_GUIDELINE]
        .filter(Boolean)
        .join('\n\n');
      return undefined;
    });
    pi.on('tool_call', (raw) => guardSubagentCall(deps, raw as unknown as GuardInput));
    pi.on('tool_result', (raw) => {
      onSubagentResult(
        deps,
        raw as unknown as { toolName: string; input: Record<string, unknown> },
      );
      return undefined;
    });
    pi.on('session_start', (_raw, ctxRaw) => {
      const ctx = ctxRaw as unknown as {
        sessionManager: { getSessionId(): string | undefined };
        cwd: string;
      };
      registerParentSession(deps, preloaded, bridgePath, pi, ctx, {
        agents: [...SERVICE_RUNTIME_AGENTS, ...runAgents],
        registrations,
        credentials,
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

function registerParentSession(
  deps: SessionFactoryDeps,
  preloaded: Preloaded,
  bridgePath: string,
  pi: ExtensionAPI,
  ctx: { sessionManager: { getSessionId(): string | undefined }; cwd: string },
  session: { agents: RuntimeAgent[]; registrations: Registration[]; credentials: CredentialStore },
): void {
  const { registrations } = session;
  const sessionId = ctx.sessionManager.getSessionId();
  if (!sessionId) throw new Error('Subagent parent has no session identity; refusing to start.');
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
  registerParent({ taskId, runId, sessionId, tools: parentTools, roleId: 'default', agents });
  storeHost(taskId, {
    dataDir: deps.ctx.paths.root,
    cwd: ctx.cwd,
    allowedTools: parentTools.filter((tool) => tool !== 'ask_user'),
    mcpProxies: [],
    runMemory: run.snapshot.memory,
    audit: deps.audit,
    resourceIds: run.snapshot.input.files.map((file) => file.id),
    credentials: session.credentials,
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
