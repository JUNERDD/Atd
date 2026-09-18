import path from 'node:path';
import { homedir } from 'node:os';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { configureModel } from './worker-model';
import { loadHermes, type HermesHost } from './hermes-host';
import { createTaskSession, toolNames, type TaskSession } from './worker-session';
import { WorkerInboundSchema, type WorkerRequest } from './worker-contract';
import { answerWorker, cancelQuestions, nativePending, publish } from './worker-channel';
import {
  firstInvocationRunId,
  fromSessionBranch,
  projectBlocks,
  sessionGrants,
} from './transcript';
import { runThinkingLevel } from './task-schema';
import { errorMessage, parse } from './validation';

let root = '';
let paused = false;
let policyVersion = 0;
let memory: HermesHost | null = null;
const sessions = new Map<string, TaskSession>();
interface Execution {
  taskId: string;
  abort: boolean;
  session: TaskSession | null;
  sessionReady: Promise<TaskSession> | null;
}
const executions = new Map<string, Execution>();

function runningSession(taskId: string): TaskSession {
  const task = sessions.get(taskId);
  if (!task) throw new Error('The task session is not running.');
  return task;
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.action) {
    case 'initialize': {
      root = request.root;
      paused = request.paused;
      memory = await loadHermes(path.join(root, 'agent'));
      return null;
    }
    case 'run': {
      if (!memory) throw new Error('The Agent runtime is not ready.');
      const execution: Execution = {
        taskId: request.taskId,
        abort: false,
        session: null,
        sessionReady: null,
      };
      executions.set(request.run.id, execution);
      try {
        let task = sessions.get(request.taskId);
        if (!task) {
          execution.sessionReady = createTaskSession(
            { root, memory, canLearn: () => !paused, policyVersion: () => policyVersion },
            request,
          );
          task = await execution.sessionReady;
          sessions.set(request.taskId, task);
        }
        execution.session = task;
        task.current = request;
        await task.session.setModel(
          await configureModel(task.models, request.run.snapshot.model, () => ({
            taskId: request.taskId,
            runId: request.run.id,
          })),
        );
        task.session.setThinkingLevel(runThinkingLevel(request.run.snapshot));
        task.session.setActiveToolsByName(toolNames(request, !paused));
        task.session.sessionManager.appendCustomEntry('app-invocation', {
          runId: request.run.id,
          source:
            request.run.snapshot.command && task.session.messages.length === 0 ? 'command' : 'user',
        });
        if (execution.abort)
          return { stopped: true, error: '', sessionFile: task.session.sessionFile };
        const version = policyVersion;
        const snapshot = request.run.snapshot;
        // Command starts prompt the resolved instruction so the model input,
        // the transcript and the displayed user bubble agree (the design shows
        // the instruction, e.g. "Translate the selection into English.", not
        // the raw selection). Follow-ups prompt the raw follow-up text.
        const isCommandStart = Boolean(snapshot.command) && task.session.messages.length === 0;
        const inputText = request.run.snapshot.input.text;
        let promptText =
          (isCommandStart ? snapshot.instructions : '') ||
          inputText ||
          (request.run.snapshot.command
            ? `Run ${request.run.snapshot.command.name}.`
            : 'Use the attached context.');
        // Custom templates are not required to reference the captured text; if
        // the instruction omits it, still deliver it so user material is never
        // silently dropped. The history preview mirrors this rule (UserContext).
        if (isCommandStart && inputText && !promptText.includes(inputText))
          promptText += `\n\n${inputText}`;
        await memory.runWithPolicy(
          () => request.run.snapshot.memory && !paused && policyVersion === version,
          () => task!.session.prompt(promptText, { expandPromptTemplates: false }),
        );
        task.flush();
        const last = [...task.session.messages]
          .reverse()
          .find((message) => message.role === 'assistant');
        return {
          stopped: execution.abort,
          error:
            last?.role === 'assistant' && last.stopReason === 'error'
              ? (last.errorMessage ?? 'The model request failed.')
              : '',
          sessionFile: task.session.sessionFile,
        };
      } finally {
        executions.delete(request.run.id);
      }
    }
    case 'transcript': {
      if (!memory) throw new Error('The Agent runtime is not ready.');
      const task = sessions.get(request.taskId);
      if (task) {
        task.flush();
        const document = task.document();
        return { revision: document.revision, blocks: document.blocks, grants: task.grants() };
      }
      if (!request.sessionFile) return { revision: 0, blocks: [], grants: [] };
      const manager = SessionManager.open(
        request.sessionFile,
        path.join(root, 'agent', 'sessions', request.taskId),
        homedir(),
      );
      const branch = fromSessionBranch(manager.getBranch());
      return {
        revision: 0,
        blocks: projectBlocks({
          branch,
          defaultRunId: firstInvocationRunId(branch) ?? request.taskId,
          live: false,
        }),
        grants: sessionGrants(branch),
      };
    }
    case 'record': {
      if (!memory) throw new Error('The Agent runtime is not ready.');
      const task = runningSession(request.taskId);
      task.session.sessionManager.appendCustomEntry('app-permission', request.record);
      task.flush();
      return null;
    }
    case 'queue': {
      if (!memory) throw new Error('The Agent runtime is not ready.');
      const task = runningSession(request.taskId);
      switch (request.mode) {
        case 'followUp':
          await task.session.followUp(request.text);
          break;
        case 'steer':
          await task.session.steer(request.text);
          break;
        default: {
          const _exhaustive: never = request.mode;
          return _exhaustive;
        }
      }
      return null;
    }
    case 'replaceQueue': {
      if (!memory) throw new Error('The Agent runtime is not ready.');
      const task = runningSession(request.taskId);
      const previous = task.session.clearQueue();
      for (const text of previous.steering) await task.session.steer(text);
      for (const text of request.followUp) await task.session.followUp(text);
      return null;
    }
    case 'stop': {
      if (!memory) throw new Error('The Agent runtime is not ready.');
      const execution = executions.get(request.runId);
      if (!execution) return null;
      execution.abort = true;
      cancelQuestions(request.runId);
      const session =
        execution.session ?? (await execution.sessionReady?.catch(() => undefined)) ?? null;
      if (session) await session.session.abort();
      return null;
    }
    case 'answer':
      if (!memory) throw new Error('The Agent runtime is not ready.');
      answerWorker(request.requestId, request.answer);
      return null;
    case 'memory':
      if (!memory) throw new Error('The Agent runtime is not ready.');
      return memory.list();
    case 'pause':
      if (!memory) throw new Error('The Agent runtime is not ready.');
      policyVersion++;
      paused = request.paused;
      for (const task of sessions.values())
        task.session.setActiveToolsByName(toolNames(task.current, !paused));
      return null;
    case 'memoryUpdate':
      if (!memory) throw new Error('The Agent runtime is not ready.');
      policyVersion++;
      return memory.update(request.entry, request.content);
    case 'forget': {
      if (!memory) throw new Error('The Agent runtime is not ready.');
      const forgotten = sessions.get(request.taskId);
      if (forgotten) {
        forgotten.release();
        await forgotten.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'new' });
        forgotten.session.dispose();
      }
      sessions.delete(request.taskId);
      return null;
    }
    case 'shutdown': {
      if (!memory) throw new Error('The Agent runtime is not ready.');
      policyVersion++;
      paused = true;
      await Promise.allSettled(
        [...executions.entries()].map(async ([runId, execution]) => {
          execution.abort = true;
          cancelQuestions(runId);
          const session =
            execution.session ?? (await execution.sessionReady?.catch(() => undefined)) ?? null;
          if (session) await session.session.abort();
        }),
      );
      for (const task of sessions.values()) {
        task.release();
        await task.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
        task.session.dispose();
      }
      memory.close();
      return null;
    }
    default: {
      const _exhaustive: never = request;
      return _exhaustive;
    }
  }
}

process.parentPort.on('message', (event) => {
  const message = parse(WorkerInboundSchema, event.data);
  if (message.type === 'nativeData') {
    nativePending.get(message.id)?.onData(message.data);
    return;
  }
  if (message.type === 'nativeResponse') {
    const pending = nativePending.get(message.id);
    nativePending.delete(message.id);
    if (message.ok) pending?.resolve(message.value);
    else pending?.reject(new Error(message.error));
    return;
  }
  void handle(message.request).then(
    (value) => publish({ type: 'response', id: message.id, ok: true, value, error: '' }),
    (reason) =>
      publish({
        type: 'response',
        id: message.id,
        ok: false,
        value: null,
        error: errorMessage(reason),
      }),
  );
});
