import type {
  AssistantMessage,
  ToolResultMessage,
  Usage,
  UserMessage,
} from '@earendil-works/pi-ai';
import type { PermissionRecord, QuestionRecord } from './permission-schema';
import type { ProjectBranchItem } from './transcript';

const usage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const RUN_ID = 'run1';
export const USER_TS = 1000;
export const ASSISTANT_TS = 2000;
export const ABORTED_TS = 3000;
export const EDIT_CALL = 'call-edit';
export const ASK_CALL = 'call-ask';

export function userMessage(
  text: string | UserMessage['content'],
  timestamp = USER_TS,
): UserMessage {
  return { role: 'user', content: text, timestamp };
}

export function assistantMessage(
  content: AssistantMessage['content'],
  extra: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'openai',
    model: 'test',
    usage,
    stopReason: 'toolUse',
    timestamp: ASSISTANT_TS,
    ...extra,
  };
}

export function toolResult(
  toolCallId: string,
  toolName: string,
  extra: Partial<ToolResultMessage> = {},
): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
    timestamp: ASSISTANT_TS + 100,
    ...extra,
  };
}

export const permissionDeclined: PermissionRecord = {
  toolCallId: EDIT_CALL,
  runId: RUN_ID,
  scope: { tool: 'edit', location: 'inside' },
  outcome: 'declined',
  at: 2050,
};

export const questionAnswered: QuestionRecord = {
  toolCallId: ASK_CALL,
  runId: RUN_ID,
  answer: 'Option A',
  at: 2200,
};

export function workingAssistant(): AssistantMessage {
  return assistantMessage([
    { type: 'text', text: 'I will look that up.' },
    { type: 'thinking', thinking: 'Need the file and a choice.' },
    {
      type: 'toolCall',
      id: EDIT_CALL,
      name: 'edit',
      arguments: { path: 'note.txt', edits: [{ oldText: 'a', newText: 'b' }] },
    },
    {
      type: 'toolCall',
      id: ASK_CALL,
      name: 'ask_user',
      arguments: { question: 'Which option?', options: ['Option A', 'Option B'] },
    },
  ]);
}

export function abortedAssistant(): AssistantMessage {
  return assistantMessage([{ type: 'text', text: 'Stopped there.' }], {
    timestamp: ABORTED_TS,
    stopReason: 'aborted',
    errorMessage: '',
  });
}

export function settledBranch(): ProjectBranchItem[] {
  const assistant = workingAssistant();
  return [
    { type: 'custom', customType: 'app-invocation', data: { runId: RUN_ID, source: 'user' } },
    { type: 'custom_message', customType: 'app-material', content: 'hidden', display: false },
    { type: 'message', message: userMessage('Hello') },
    { type: 'message', message: assistant },
    {
      type: 'message',
      message: toolResult(EDIT_CALL, 'edit', {
        isError: true,
        content: [{ type: 'text', text: 'The user declined this action.' }],
        details: { diff: '--- a/note.txt\n+++ b/note.txt\n', truncation: { truncated: true } },
        timestamp: 2100,
      }),
    },
    {
      type: 'message',
      message: toolResult(ASK_CALL, 'ask_user', {
        content: [{ type: 'text', text: 'Option A' }],
        timestamp: 2200,
      }),
    },
    { type: 'custom', customType: 'app-permission', data: permissionDeclined },
    { type: 'custom', customType: 'app-question', data: questionAnswered },
    { type: 'message', message: abortedAssistant() },
  ];
}

export function livePrefix(): ProjectBranchItem[] {
  return settledBranch().filter(
    (item) =>
      !(
        item.type === 'message' &&
        item.message.role === 'assistant' &&
        item.message.timestamp === ABORTED_TS
      ),
  );
}
