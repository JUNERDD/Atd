import type { TaskRun } from '@atd/agent-contracts';
import type { LiveState } from './live-state.js';
import { sessionMemory } from './memory/session-memory.js';
import type { SessionFactoryDeps } from './pi-session.js';
import { leadingSystemMessage, runMaterialContext } from './prompt-context.js';
import { buildRunSession, openSessionBase } from './session-base.js';

/**
 * The system prompt of a lite session. It names nothing the session lacks (tools, skills,
 * folders), so the model is not told about capabilities it cannot use.
 */
const LITE_SYSTEM_PROMPT =
  "You are a helpful desktop assistant. The user's message is a saved command the user ran: follow its instructions and answer directly. The app may send hidden context just before the user message it belongs to: <run_material> holds further instructions for it, such as how the answer will be used.";

/**
 * `LiveState.bindingKey` of a lite session. A full session's key is a JSON object (run-binding.ts)
 * and a compaction session's is empty, so no other run ever matches it: any later run of the task
 * reopens the session file in a full session.
 */
const LITE_BINDING_KEY = 'lite';

/**
 * The lightweight session of a `lite` run (`RunSnapshot.lite`, commands/lite.ts): the same session
 * file, model, request and compaction policies as the full session (session-base.ts), so its
 * ledger, transcript, events and audit are the same, but no tools, skills, MCP servers, subagents
 * or harness, and none of the freezes that feed them. Its extensions are compaction, the run's
 * core memory as the `memory_core` system prompt section, as a full session renders it
 * (memory/session-memory.ts), the run's hidden material before the prompt, and the leading system
 * message. A follow-up's full session reopens the same file and Pi patches the sections it differs
 * in, so the lite core is replaced by the full one with its policy and index. Messages queued while
 * a lite session answers never reach it: the full session takes them (tasks/held-queue.ts).
 */
export async function createLiteState(deps: SessionFactoryDeps, run: TaskRun): Promise<LiveState> {
  const base = await openSessionBase(deps, run);
  return buildRunSession(deps, run, base, {
    systemPrompt: LITE_SYSTEM_PROMPT,
    extensionFactories: [
      base.compaction.extension(),
      // Only `memory_core`: the lite freeze leaves the policy and index empty (run-prepare.ts).
      sessionMemory(() => deps.currentMaterial().memory),
      runMaterialContext(deps.currentMaterial),
      leadingSystemMessage(),
    ],
    tools: [],
    bindingKey: LITE_BINDING_KEY,
  });
}
