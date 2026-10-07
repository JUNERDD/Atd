import {
  TASK_AGENTS_PER_TASK,
  taskAgentName,
  type TaskAgentDefinition,
  type ThinkingLevel,
} from '@atd/agent-contracts';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { SessionFactoryDeps } from '../pi-session.js';
import type { RuntimeAgentDefinition } from './agents.js';
import { nameCollisions, type NameCollision } from './configured-agents.js';
import { launchModelReference } from './launch-model.js';
import { hostForTask, storeHost } from './registry.js';
import {
  DEFINE_AGENTS_SHAPE,
  definitionProblem,
  parseTaskAgentRequests,
  requestedDefinition,
  sameDefinition,
  taskRuntimeDefinition,
  thinksAbove,
  type TaskAgentRequest,
} from './task-agent-definition.js';
import { agentEntry, appendAgentEntries, recordedAgents } from './task-agent-records.js';

/**
 * The agents one parent session may delegate to and the capability ceiling pi-subagents enforces
 * on its children. The session's own runtime agents (its enabled catalog subagents, often none)
 * are fixed when it starts; its task agents are the ones the parent defines with
 * `subagent { action: "define" }`, for the rest of its task. This module is the one owner of
 * both and of the ceiling: it registers task agents on the session's `pi`, records each accepted
 * definition in the parent session (`app-agent`, task-agent-records.ts), replays the recorded
 * ones when the task's session starts again, follows the branch when a run rewinds it, tells the
 * guard which agent a launch may name and the launch trigger which model and thinking a child
 * must carry, and sends pi-subagents the whole ceiling (child tools and agent names) whenever
 * either part changes, so a define and enrichment (enrich.ts) never overwrite each other.
 */

/** A pi-subagents registration released with its session or its definition. */
interface Registration {
  dispose(): void;
}

/** What the guard and the launch trigger ask about a parent's agents (registry.ts). */
export interface ParentAgents {
  /** Why a launch cannot name `agent` in the parent's current run, or null when it can. */
  refusal(agent: unknown): string | null;
  /**
   * The model reference a child of `agent` must launch with under run `runId`: the run's model
   * at the thinking the session registered for the agent (launch-model.ts); null when the
   * session registered no such agent.
   */
  launchModel(runId: string, agent: string): string | null;
}

export interface TaskAgentsInput {
  deps: SessionFactoryDeps;
  sessions: SessionManager;
  /** The parent's cwd, from which pi-subagents discovers configured agents. */
  cwd: string;
  /** The runtime agents the session registered when it started. */
  sessionAgents: readonly { name: string; definition: { thinking: string } }[];
  /** The child tools the ceiling starts with, until enrichment narrows them. */
  childTools: readonly string[];
  /** pi-subagents' ceiling for the session; `update` replaces all of it. */
  ceiling: { update(ceiling: { allowedTools: string[]; allowedAgents: string[] }): void };
  /** Registers a runtime agent on the session's `pi`. */
  register(name: string, definition: RuntimeAgentDefinition): Registration;
}

export interface TaskAgents extends Registration, ParentAgents {
  /** Narrows the child tools of the ceiling and the child host (enrich.ts); never widens them. */
  narrowTools(allowedTools: readonly string[]): void;
  /** Registers the recorded task agents the current run allows; audits the rest. */
  replay(collision: NameCollision): void;
  /** Releases the task agents the branch no longer records, as after a rewind (`session_tree`). */
  followBranch(): void;
  /** Handles a define call: the result text, or a thrown refusal that defined nothing. */
  define(toolCallId: string, agents: unknown): Promise<string>;
}

type Accepted = { kind: 'new' | 'restored' | 'unchanged'; definition: TaskAgentDefinition };
type Refused = { kind: 'refused'; agent: string; reason: string };

/** Most agent names a refusal lists; a session registers every enabled catalog agent. */
const REFUSAL_MAX_NAMES = 24;

/** Why task agents wait for enrichment: until then the ceiling lacks the role's narrowing. */
const UNNARROWED = "the run's child tools could not be narrowed to its role and revocations";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A definition's tools and thinking, as define results and refusals state them. */
function summary(definition: TaskAgentDefinition): string {
  const tools = definition.tools.length ? `tools ${definition.tools.join(', ')}` : 'no tools';
  return `${tools}; thinking ${definition.thinking}`;
}

/** Agent names for a refusal, bounded (`list` shows every one), or how to get one without any. */
function namesText(names: readonly string[]): string {
  if (!names.length)
    return 'none yet; define a task agent with { action: "define" }, then launch it in a later message';
  const shown = names.slice(0, REFUSAL_MAX_NAMES).join(', ');
  const more = names.length - REFUSAL_MAX_NAMES;
  return more > 0 ? `${shown} and ${more} more ({ action: "list" } shows them)` : shown;
}

export function createTaskAgents(input: TaskAgentsInput): TaskAgents {
  const { deps, sessions } = input;
  const sessionThinking = new Map(
    input.sessionAgents.map((agent) => [agent.name, agent.definition.thinking]),
  );
  const registered = new Map<
    string,
    { definition: TaskAgentDefinition; registration: Registration }
  >();
  let childTools = [...input.childTools];
  let narrowed = false;
  let disposed = false;
  /** Recorded task agents replay skipped, with the reason it audited, for the launch refusal. */
  const skipped = new Map<string, string>();

  const runThinking = (): ThinkingLevel => {
    try {
      return deps.ctx.ledger.run(deps.taskId, deps.currentRunId()).snapshot.thinkingLevel ?? 'off';
    } catch {
      // A run the ledger cannot find allows the least thinking.
      return 'off';
    }
  };
  const audit = (entry: Record<string, unknown>) =>
    deps.audit({ taskId: deps.taskId, runId: deps.currentRunId(), ...entry });
  const publish = () => {
    if (disposed) return;
    const allowedAgents = [...sessionThinking.keys(), ...registered.keys()];
    input.ceiling.update({ allowedTools: [...childTools], allowedAgents });
  };
  const release = (agent: string) => {
    registered.get(agent)?.registration.dispose();
    registered.delete(agent);
  };
  /**
   * Registers a definition and admits it in the ceiling; null when both landed, else why not,
   * with nothing left registered: the guard never admits a name the ceiling refused.
   */
  const enlist = (definition: TaskAgentDefinition): string | null => {
    if (disposed) return 'the session has ended';
    let registration: Registration;
    try {
      registration = input.register(definition.agent, taskRuntimeDefinition(definition));
    } catch (error) {
      return errorText(error);
    }
    registered.set(definition.agent, { definition, registration });
    try {
      publish();
      return null;
    } catch (error) {
      release(definition.agent);
      return errorText(error);
    }
  };
  /** Releases enlisted agents; a ceiling still naming them only admits what the guard refuses. */
  const retract = (agents: readonly string[]) => {
    for (const agent of agents) release(agent);
    try {
      publish();
    } catch {
      // The guard no longer admits them, and it decides every launch first.
    }
  };

  const followBranch = () => {
    const kept = recordedAgents(sessions.getBranch()).definitions;
    for (const agent of skipped.keys()) if (!kept.has(agent)) skipped.delete(agent);
    const dropped = [...registered.keys()].filter((agent) => !kept.has(agent));
    if (dropped.length) retract(dropped);
    for (const agent of dropped)
      audit({ taskAgent: agent, decision: 'drop', reason: 'the branch no longer records it' });
  };

  /** What a define call does with each requested agent, against the branch and the current run. */
  const decide = (
    requests: readonly TaskAgentRequest[],
    collision: NameCollision,
  ): (Accepted | Refused)[] => {
    const run = { childTools, thinking: runThinking() };
    const known = recordedAgents(sessions.getBranch()).definitions;
    return requests.map((request, index): Accepted | Refused => {
      const existing = known.get(taskAgentName(request.name));
      // An omitted thinking matches the record: the run level it defaulted to may have changed.
      const definition = requestedDefinition(request, existing?.thinking ?? run.thinking);
      const refuse = (reason: string): Refused => ({
        kind: 'refused',
        agent: definition.agent,
        reason,
      });
      if (requests.findIndex((other) => other.name === request.name) !== index)
        return refuse('this call names it more than once');
      if (existing && !sameDefinition(existing, definition))
        return refuse(
          `this task already defines it differently (${summary(existing)}); define a new name to change it`,
        );
      if (existing && registered.has(existing.agent))
        return { kind: 'unchanged', definition: existing };
      // A recorded agent the session skipped at replay registers again once the run allows it.
      const reason = definitionProblem(definition, run) ?? collision(definition.agent);
      if (reason) return refuse(reason);
      return { kind: existing ? 'restored' : 'new', definition };
    });
  };

  /** Registers accepted agents, then records the new ones; a failure undoes this call's agents. */
  const commit = (toolCallId: string, accepted: readonly Accepted[]): void => {
    const definedAt = new Date().toISOString();
    const entries = accepted.flatMap(({ kind, definition }) =>
      kind === 'new' ? [agentEntry(definition, toolCallId, definedAt)] : [],
    );
    const added: string[] = [];
    try {
      for (const { kind, definition } of accepted) {
        if (kind === 'unchanged') continue;
        const refused = enlist(definition);
        if (refused) throw new Error(`${definition.agent} could not be registered: ${refused}`);
        added.push(definition.agent);
        skipped.delete(definition.agent);
      }
      appendAgentEntries(sessions, entries);
    } catch (error) {
      retract(added);
      throw error;
    }
  };

  return {
    refusal(agent) {
      // No agent has an empty name, so a launch naming none gets the list below.
      const name = typeof agent === 'string' ? agent : '';
      if (sessionThinking.has(name)) return null;
      const task = registered.get(name);
      const skip = skipped.get(name);
      // Defining is refused, too, while the child tools are not narrowed.
      if (!task && skip !== undefined)
        return `${name} is a task agent from earlier in this task, but it is not available in this run: ${skip}.${narrowed ? ' Define a task agent with a new name to use one now.' : ''}`;
      if (!task)
        return `Subagent agent must be one of: ${namesText([...registered.keys(), ...sessionThinking.keys()])}.`;
      // A session a later run reuses keeps its task agents, while each run sets its own level.
      const level = runThinking();
      return thinksAbove(task.definition.thinking, level)
        ? `${task.definition.agent} thinks at ${task.definition.thinking}, above this run's ${level}; define another task agent for this run.`
        : null;
    },

    launchModel(runId, agent) {
      const thinking = sessionThinking.get(agent) ?? registered.get(agent)?.definition.thinking;
      if (thinking === undefined) return null;
      try {
        return launchModelReference(
          deps.ctx.ledger.run(deps.taskId, runId).snapshot.model,
          thinking,
        );
      } catch {
        // A run the ledger cannot find launches no child.
        return null;
      }
    },

    narrowTools(allowedTools) {
      if (disposed) return;
      // The ceiling first: when pi-subagents refuses the update, the sync tools stand everywhere.
      input.ceiling.update({
        allowedTools: [...allowedTools],
        allowedAgents: [...sessionThinking.keys(), ...registered.keys()],
      });
      childTools = [...allowedTools];
      narrowed = true;
      const host = hostForTask(deps.taskId);
      if (host) storeHost(deps.taskId, { ...host, allowedTools: [...allowedTools] });
    },

    replay(collision) {
      if (disposed) return;
      const { definitions, ignored } = recordedAgents(sessions.getBranch());
      for (const { agent, reason } of ignored)
        audit({ taskAgent: agent, decision: 'ignore', reason });
      const run = { childTools, thinking: runThinking() };
      for (const definition of definitions.values()) {
        const problem = narrowed
          ? (definitionProblem(definition, run) ?? collision(definition.agent))
          : UNNARROWED;
        const reason = problem ?? enlist(definition);
        if (reason) skipped.set(definition.agent, reason);
        audit(
          reason
            ? { taskAgent: definition.agent, decision: 'skip', reason }
            : { taskAgent: definition.agent, decision: 'replay' },
        );
      }
    },

    followBranch,

    async define(toolCallId, agents) {
      const requests = parseTaskAgentRequests(agents);
      if (!requests)
        throw new Error(`Subagent action define takes agents: ${DEFINE_AGENTS_SHAPE}.`);
      if (!narrowed) throw new Error(`Task agents are unavailable in this session: ${UNNARROWED}.`);
      const { collision } = await nameCollisions(input.cwd);
      // Nothing below awaits, so the define calls of one message take effect one after another.
      if (disposed) throw new Error('Task agents are unavailable: the session has ended.');
      followBranch();
      const outcomes = decide(requests, collision);
      const refused = outcomes.filter((outcome): outcome is Refused => outcome.kind === 'refused');
      const accepted = outcomes.filter(
        (outcome): outcome is Accepted => outcome.kind !== 'refused',
      );
      const recorded = recordedAgents(sessions.getBranch()).definitions.size;
      const total = recorded + accepted.filter(({ kind }) => kind === 'new').length;
      const problems = refused.map(({ agent, reason }) => `- ${agent}: ${reason}.`);
      if (total > TASK_AGENTS_PER_TASK)
        problems.push(
          `- A task holds at most ${TASK_AGENTS_PER_TASK} task agents; this call would make ${total}.`,
        );
      if (problems.length) {
        const taskAgents = refused.map(({ agent }) => agent);
        const reason = problems.join(' ').slice(0, 500);
        audit({ toolCallId, taskAgents, decision: 'refuse', reason });
        throw new Error(['Nothing was defined:', ...problems].join('\n'));
      }
      commit(toolCallId, accepted);
      for (const { kind, definition } of accepted)
        audit({ toolCallId, taskAgent: definition.agent, decision: kind });
      return [
        'Task agents for this task; launch them in a later message as { agent, task }:',
        ...accepted.map(
          ({ kind, definition }) =>
            `- ${definition.agent}: ${summary(definition)}${kind === 'new' ? '' : ' (already defined)'}`,
        ),
      ].join('\n');
    },

    dispose() {
      disposed = true;
      // A Map's iteration goes on past the entry it just deleted.
      for (const agent of registered.keys()) release(agent);
    },
  };
}
