import { CAPTURE_ANSWER_TOOL, type TaskRun } from '@atd/agent-contracts';
import { captureAnswerExtension } from './commands/capture-tool.js';
import type { LiveState } from './live-state.js';
import { sessionMemory } from './memory/session-memory.js';
import type { SessionFactoryDeps } from './pi-session.js';
import { leadingSystemMessage, runMaterialContext } from './prompt-context.js';
import { buildRunSession, openSessionBase } from './session-base.js';

/**
 * The system prompts of a lite session: one for a saved command (`fromCommand`), one for a direct
 * inline question (`Ask Atd`), and one for screenshot markup asks that declare `mark_screenshot`.
 * Non-landing runs name nothing the session lacks (tools, skills, folders).
 */
const LITE_COMMAND_SYSTEM_PROMPT =
  "You are a helpful desktop assistant. The user's message is a saved command the user ran: follow its instructions and answer directly. The app may send hidden context just before the user message it belongs to: <run_material> holds further instructions for it, such as how the answer will be used.";

const LITE_COMMAND_CAPTURE_SYSTEM_PROMPT =
  "You are a helpful desktop assistant. The user's message is a saved command the user ran: follow its content rules, and deliver the result via mark_screenshot tool call(s) (or plain text when <run_material> says no marks are needed) with no surrounding conversational text (this view has no local file or shell tools). The app may send hidden context just before the user message it belongs to: <run_material> holds the recognized text, attached context, and how the answer will be used.";

const LITE_ASK_SYSTEM_PROMPT =
  "You are a helpful desktop assistant. Answer the user's request directly from the provided text and context; this view has no tools or local file access. The app may send hidden context just before the user message it belongs to: <run_material> holds the recognized text, attached context, and how the answer will be used.";

const LITE_CAPTURE_ASK_SYSTEM_PROMPT =
  "You are a helpful desktop assistant. Answer the user's request from the attached screenshot and recognized text; when instructed to mark or update the screenshot, call mark_screenshot as <run_material> directs and otherwise reply directly in plain text (this view has no local file or shell tools). The app may send hidden context just before the user message it belongs to: <run_material> holds the recognized text, attached context, and how the answer will be used.";

/**
 * `LiveState.bindingKey` of a lite session. A full session's key is a JSON object (run-binding.ts)
 * and a compaction session's is empty, so no other run ever matches it: any later run of the task
 * reopens the session file in a full session.
 */
const LITE_BINDING_KEY = 'lite';
const LITE_CAPTURE_BINDING_KEY = 'lite:capture';

/**
 * The lightweight session of a `lite` run (`RunSnapshot.lite`, commands/lite.ts): the same session
 * file, model, request and compaction policies as the full session (session-base.ts), so its
 * ledger, transcript, events and audit are the same, with no skills, MCP servers, subagents or
 * harness, and `mark_screenshot` only when `RunSnapshot.captureOutput` lands on the screenshot.
 */
export async function createLiteState(deps: SessionFactoryDeps, run: TaskRun): Promise<LiveState> {
  const base = await openSessionBase(deps, run);
  const capture = run.snapshot.captureOutput !== undefined;
  const systemPrompt = run.snapshot.fromCommand
    ? capture
      ? LITE_COMMAND_CAPTURE_SYSTEM_PROMPT
      : LITE_COMMAND_SYSTEM_PROMPT
    : capture
      ? LITE_CAPTURE_ASK_SYSTEM_PROMPT
      : LITE_ASK_SYSTEM_PROMPT;
  return buildRunSession(deps, run, base, {
    systemPrompt,
    extensionFactories: [
      base.compaction.extension(),
      // Only `memory_core`: the lite freeze leaves the policy and index empty (run-prepare.ts).
      sessionMemory(() => deps.currentMaterial().memory),
      runMaterialContext(deps.currentMaterial),
      leadingSystemMessage(),
      ...(capture
        ? [
            captureAnswerExtension(() => ({
              ledger: deps.ctx.ledger,
              taskId: deps.taskId,
              runId: deps.currentRunId(),
            })),
          ]
        : []),
    ],
    tools: capture ? [CAPTURE_ANSWER_TOOL] : [],
    bindingKey: capture ? LITE_CAPTURE_BINDING_KEY : LITE_BINDING_KEY,
  });
}
