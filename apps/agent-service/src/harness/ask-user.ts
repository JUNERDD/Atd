import { Type } from 'typebox';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { HarnessDeps } from './deps.js';

const ASK_USER_CANCELLED = 'The user cancelled the request.';

/**
 * `ask_user`: asks the user for missing input through the confirm store. The answer is recorded
 * as the `app-question` custom entry so the transcript shows it after reopen.
 */
export function askUserExtension(deps: HarnessDeps): ExtensionFactory {
  const { runner, sessions } = deps;
  return (pi) => {
    pi.registerTool({
      name: 'ask_user',
      label: 'Ask for input',
      description: 'Ask the user for missing information needed to continue this task.',
      parameters: Type.Object({
        question: Type.String(),
        options: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })),
      }),
      async execute(id, args) {
        const params = args as { question: string; options?: string[] };
        const runId = runner.currentRunId();
        runner.audit({ taskId: runner.taskId, runId, tool: 'ask_user', decision: 'request' });
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
          sessions.appendCustomEntry('app-question', {
            toolCallId: id,
            runId,
            answer: skipped ? null : text,
            at: Date.now(),
          });
          deps.reproject();
          return { content: [{ type: 'text', text }], details: {} };
        } finally {
          runner.setStatus(runId, 'running');
        }
      },
    });
  };
}
