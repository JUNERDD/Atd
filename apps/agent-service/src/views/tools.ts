import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import {
  errorMessage,
  SHOW_UI_TOOL,
  ShowUiParamsSchema,
  UPDATE_UI_TOOL,
  UpdateUiParamsSchema,
  VIEW_DISMISSED_TEXT,
  VIEW_RESPONSE_PREFIX,
  type ShowUiParams,
} from '@atd/agent-contracts';
import type { HarnessDeps } from '../harness/deps.js';
import type { SessionFactoryDeps } from '../pi-session.js';
import type { RunBinding } from '../run-binding.js';
import type { RunnerContext } from '../task-runner.js';
import { auditUnattended, isUnattendedRun, UNATTENDED_ANSWER } from '../unattended.js';
import { findShowUiCall } from './calls.js';
import { viewDataProblem, viewProblems } from './content.js';
import { VIEW_INITIATIVE_SECTION, VIEW_INITIATIVE_TEXT } from './initiative.js';
import { loadViewKit } from './kit.js';

/**
 * What the view tools use of the harness deps: the task's current run and its material, its
 * confirms and session, and the tools the session's binding declares.
 */
export type ViewToolDeps = Pick<HarnessDeps, 'sessions'> & {
  binding: Pick<RunBinding, 'tools'>;
  runner: Pick<
    SessionFactoryDeps,
    'taskId' | 'currentRunId' | 'currentMaterial' | 'executionId' | 'audit' | 'setStatus'
  > & {
    ctx: Pick<RunnerContext, 'ledger' | 'confirms' | 'log'>;
  };
};

type ToolText = { content: { type: 'text'; text: string }[]; details: Record<string, never> };

function answer(text: string): ToolText {
  return { content: [{ type: 'text', text }], details: {} };
}

function refusal(text: string): ToolText & { isError: true } {
  return { ...answer(text), isError: true };
}

/**
 * Generative views (packages/agent-contracts views.ts): `show_ui` shows agent-written HTML as an
 * interactive view, a widget inline in the turn that opens the view's window when clicked, and
 * `update_ui` replaces a shown view's data, which the widget and the window both receive. Neither
 * writes custom entries: the renderer reads a view's documents, data and answer from the
 * transcript's calls. A `show_ui` call that waits asks through the confirm store as an `input`
 * request without options, as `ask_user` does, and the window's message answers it. Model-only:
 * the renderer draws a view from the model's own call, which a codemode script's call is not.
 * An attended run's model is also told how readily to show a view, the user's setting
 * (`viewInitiative`, initiative.ts), in the `interactive_views` system prompt section.
 */
export function viewsExtension(deps: ViewToolDeps): ExtensionFactory {
  const { binding, runner, sessions } = deps;

  /** Why the view cannot be shown, as one error the model can act on; null when it can. */
  const refused = async (params: ShowUiParams): Promise<string | null> => {
    const kit = await loadViewKit().catch((error: unknown) => {
      runner.ctx.log.warn('The view kit could not be loaded.', { error: errorMessage(error) });
      return null;
    });
    if (!kit) return 'Views are unavailable: the app could not load its view kit.';
    const problems = viewProblems(params, kit.blocks);
    if (!problems.length) return null;
    return `The view was not shown. Fix these and call ${SHOW_UI_TOOL} again:\n${problems.map((problem) => `- ${problem}`).join('\n')}`;
  };

  /** Waits for the user's response through the view, like `ask_user` waits for an answer. */
  const respond = async (id: string, title: string, signal?: AbortSignal): Promise<ToolText> => {
    const runId = runner.currentRunId();
    const base = { taskId: runner.taskId, runId, tool: SHOW_UI_TOOL };
    if (isUnattendedRun(runner.ctx.ledger, runner.taskId, runId)) {
      auditUnattended(runner.audit, { ...base, kind: 'view', title });
      return answer(UNATTENDED_ANSWER);
    }
    runner.audit({ ...base, decision: 'request' });
    runner.setStatus(runId, 'awaiting_input');
    try {
      const reply = await runner.ctx.confirms.request(
        {
          taskId: runner.taskId,
          runId,
          executionId: runner.executionId(),
          toolCallId: id,
          kind: 'input',
          title,
          options: [],
        },
        signal,
      );
      return answer(
        'answer' in reply ? `${VIEW_RESPONSE_PREFIX}${reply.answer}` : VIEW_DISMISSED_TEXT,
      );
    } finally {
      runner.setStatus(runId, 'running');
    }
  };

  return (pi) => {
    pi.registerTool({
      name: SHOW_UI_TOOL,
      label: 'Show view',
      description:
        "Show an interactive view: a widget inline in the conversation that opens the view's window when the user clicks it. Load the generative-ui skill with load_skill before writing the first view of a task.",
      parameters: ShowUiParamsSchema,
      exposure: 'model-only',
      executionMode: 'sequential',
      async execute(id, params, signal) {
        signal?.throwIfAborted();
        const problem = await refused(params);
        if (problem) return refusal(problem);
        if (params.wait) return respond(id, params.title, signal);
        return answer(
          `Showing "${params.title}" as view ${id}: its widget is in the conversation, and the user opens its window from the widget. The user's messages from the window arrive as user messages; call ${UPDATE_UI_TOOL} with id "${id}" to change the data of both.`,
        );
      },
    });

    pi.registerTool({
      name: UPDATE_UI_TOOL,
      label: 'Update view',
      description: `Replace the data of a view ${SHOW_UI_TOOL} showed in this task; its widget and its window receive it through atd.onData.`,
      parameters: UpdateUiParamsSchema,
      exposure: 'model-only',
      executionMode: 'sequential',
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        const problem = viewDataProblem(params.data);
        if (problem) return refusal(`The view was not updated: ${problem}`);
        // A call whose result is an error showed no view; one without a result yet still counts.
        const call = findShowUiCall(sessions.getBranch(), params.id);
        if (!call || call.failed) return refusal(`No view with id "${params.id}" in this task.`);
        return answer(`Updated view ${params.id}.`);
      },
    });

    // The binding is fixed for the session's life, so whether it declares `show_ui` is decided
    // once; the current run's level and attendance are read per prompt, because a later run of the
    // task may freeze another level and a person may follow up on an automation's task. Pi rebuilds
    // the section options for every prompt and persists a patch only when the text changed
    // (skills/session-catalog.ts), so every prompt sets the section again.
    if (binding.tools.includes(SHOW_UI_TOOL)) {
      pi.on('before_agent_start', (event) => {
        const level = runner.currentMaterial().viewInitiative;
        if (level === null) return;
        if (isUnattendedRun(runner.ctx.ledger, runner.taskId, runner.currentRunId())) return;
        event.systemPromptOptions.sections[VIEW_INITIATIVE_SECTION] = VIEW_INITIATIVE_TEXT[level];
      });
    }
  };
}
