import type { TaskRun } from '@atd/agent-contracts';
import type { RunFolders } from './folders/material.js';
import { createLiteState } from './lite-session.js';
import type { LiveState } from './live-state.js';
import { freezeLiteRunMemory } from './memory/run-memory.js';
import {
  applyRunToSession,
  createLiveState,
  NO_RUN_MATERIAL,
  type RunAttachment,
  type RunMaterial,
  type SessionFactoryDeps,
} from './pi-session.js';
import { prepareRunBinding } from './run-binding.js';
import { freezeMemory, freezeRunSelections } from './run-freeze.js';
import type { LiveSlot } from './session-release.js';
import { runSkillsError } from './skills/run-skills.js';
import type { RuntimeAgent } from './subagents/agents.js';
import { CONTEXT_BUDGET, runInputSize } from './tasks/run-budget.js';

/**
 * What a run executes with before it prompts (task-runner.ts): its material and the session it
 * prompts on. A full run freezes its skill, role, MCP, agent, memory and reference selections
 * (run-freeze.ts) and binds its session from them (run-binding.ts); a lite run (`RunSnapshot.lite`)
 * freezes only its core memory and takes the lite session (lite-session.ts).
 */

/** A run ready for its session, or why it fails before one opens. */
export type PreparedRun =
  | { blocked: string }
  | { blocked: null; material: RunMaterial; agents: RuntimeAgent[] };

/**
 * Freezes the run's selections and reads its folders into its material. A run whose selected
 * skills cannot load is `blocked`; a folder that cannot be read throws, which fails the run.
 */
export async function prepareRun(
  deps: SessionFactoryDeps,
  run: TaskRun,
  attachments: RunAttachment[],
  folders: RunFolders,
): Promise<PreparedRun> {
  const { instructions } = run.snapshot;
  if (run.snapshot.lite) {
    deps.audit({ taskId: deps.taskId, runId: run.id, lite: true });
    // A lite run shows only its core memory, within what its input leaves of the context budget.
    const room = CONTEXT_BUDGET - runInputSize(run.snapshot);
    const memory = await freezeMemory(deps, run, (store) =>
      freezeLiteRunMemory(store, run.snapshot.memory, room),
    );
    const material = {
      ...NO_RUN_MATERIAL,
      instructions,
      attachments,
      folders: await folders(),
      memory,
    };
    return { blocked: null, material, agents: [] };
  }
  // T3/T4: skill, role, MCP and reference selections freeze once at
  // accept; the run's material and session binding come from them.
  const frozen = await freezeRunSelections(deps, run);
  const blocked = runSkillsError(run, frozen.skills.loaded, frozen.catalog);
  if (blocked) return { blocked };
  const material: RunMaterial = {
    instructions,
    attachments,
    folders: await folders(),
    references: frozen.references.material,
    skills: frozen.skills.loaded,
    catalog: frozen.catalog,
    memory: frozen.memory,
  };
  return { blocked: null, material, agents: frozen.agents };
}

/** What opening a run's session needs from its runner. */
export interface RunSessionDeps {
  session: SessionFactoryDeps;
  slot: LiveSlot;
  /** Whether Stop was requested for the run. */
  stopped: () => boolean;
}

/**
 * The session the run prompts on, once the runner holds the run's material: the live one when it
 * serves the run's binding and model (`applyRunToSession`), else a new one on the same session
 * file. A lite session serves no other run, and a lite run never reuses a session.
 */
export async function openRunSession(
  deps: RunSessionDeps,
  run: TaskRun,
  agents: RuntimeAgent[],
): Promise<LiveState> {
  const binding = run.snapshot.lite ? null : await prepareRunBinding(deps.session, run, agents);
  // An idle or tier-change release still shutting the session down ends before it reopens. A
  // run stopped while it waited ends here, leaving the session untouched.
  await deps.slot.settled();
  if (deps.stopped()) throw new Error('The run stopped before its session opened.');
  const live = deps.slot.live;
  if (live && binding && (await applyRunToSession(live, run, binding))) return live;
  // A changed run binding or another connection needs a new session;
  // reopen it from the same session file.
  await deps.slot.close('new');
  const opened = binding
    ? await createLiveState(deps.session, run, binding)
    : await createLiteState(deps.session, run);
  return deps.slot.hold(opened);
}
