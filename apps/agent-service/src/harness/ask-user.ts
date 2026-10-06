import { Type } from 'typebox';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { SessionFactoryDeps } from '../pi-session.js';
import type { RunnerContext } from '../task-runner.js';
import { auditUnattended, isUnattendedRun, UNATTENDED_ANSWER } from '../unattended.js';
import type { HarnessDeps } from './deps.js';

const ASK_USER_CANCELLED = 'The user cancelled the request.';

/** What `ask_user` uses of the harness deps: the task's current run, its confirms and session. */
export type AskUserDeps = Pick<HarnessDeps, 'sessions' | 'reproject'> & {
  runner: Pick<
    SessionFactoryDeps,
    'taskId' | 'currentRunId' | 'executionId' | 'audit' | 'setStatus'
  > & {
    ctx: Pick<RunnerContext, 'ledger' | 'confirms'>;
  };
};

/**
 * `ask_user`: asks the user for missing input through the confirm store. The answer is recorded
 * as the `app-question` custom entry so the transcript shows it after reopen. Model-only: the
 * transcript renders the question from the model's own call, which a codemode script's call is not.
 * In an unattended run (unattended.ts) nobody can answer: the tool says so at once, asks the model
 * to go on with the most reasonable assumption, and records the question as unanswered.
 */
export function askUserExtension(deps: AskUserDeps): ExtensionFactory {
  const { runner, sessions } = deps;
  const record = (toolCallId: string, runId: string, answer: string | null) => {
    sessions.appendCustomEntry('app-question', { toolCallId, runId, answer, at: Date.now() });
    deps.reproject();
  };
  return (pi) => {
    pi.registerTool({
      name: 'ask_user',
      label: 'Ask for input',
      description: 'Ask the user for missing information needed to continue this task.',
      parameters: Type.Object({
        question: Type.String(),
        options: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })),
      }),
      exposure: 'model-only',
      async execute(id, args) {
        const params = args as { question: string; options?: string[] };
        const runId = runner.currentRunId();
        const base = { taskId: runner.taskId, runId, tool: 'ask_user' };
        if (isUnattendedRun(runner.ctx.ledger, runner.taskId, runId)) {
          auditUnattended(runner.audit, { ...base, kind: 'question', title: params.question });
          record(id, runId, null);
          return { content: [{ type: 'text', text: UNATTENDED_ANSWER }], details: {} };
        }
        runner.audit({ ...base, decision: 'request' });
        runner.setStatus(runId, 'awaiting_input');
        try {
          const answer = await runner.ctx.confirms.request({
            taskId: runner.taskId,
            runId,
            executionId: runner.executionId(),
            toolCallId: id,
            kind: 'input',
            title: params.question,
            options: params.options ?? [],
          });
          const skipped = 'skipped' in answer;
          const text = skipped ? ASK_USER_CANCELLED : (answer as { answer: string }).answer;
          record(id, runId, skipped ? null : text);
          return { content: [{ type: 'text', text }], details: {} };
        } finally {
          runner.setStatus(runId, 'running');
        }
      },
    });
  };
}
