import path from 'node:path';
import { homedir } from 'node:os';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { configureModel } from './worker-model';
import { loadHermes, type HermesHost } from './hermes-host';
import { createTaskSession, toolNames, type TaskSession } from './worker-session';
import { WorkerInboundSchema, type WorkerRequest } from './worker-contract';
import { answerWorker, cancelQuestions, nativePending, publish } from './worker-channel';
import { projectTranscript } from './transcript';
import { errorMessage, parse } from './validation';

let root = '';
let paused = false;
let policyVersion = 0;
let memory: HermesHost | null = null;
const sessions = new Map<string, TaskSession>();
let running: { id: string; taskId: string; abort: boolean } | null = null;

async function handle(request: WorkerRequest): Promise<unknown> {
  if (request.action === 'initialize') {
    root = request.root;
    paused = request.paused;
    memory = await loadHermes(path.join(root, 'agent'));
    return null;
  }
  if (!memory) throw new Error('The Agent runtime is not ready.');
  switch (request.action) {
    case 'run': {
      if (running) throw new Error('Another task is running.');
      const execution = { id: request.run.id, taskId: request.taskId, abort: false };
      running = execution;
      try {
        let task = sessions.get(request.taskId);
        if (!task) {
          task = await createTaskSession(
            { root, memory, canLearn: () => !paused, policyVersion: () => policyVersion },
            request,
          );
          sessions.set(request.taskId, task);
        }
        task.current = request;
        await task.session.setModel(
          await configureModel(task.models, request.run.snapshot.model, () => ({
            taskId: request.taskId,
            runId: request.run.id,
          })),
        );
        task.session.setActiveToolsByName(toolNames(request, !paused));
        task.session.sessionManager.appendCustomEntry('app-invocation', {
          runId: request.run.id,
          source:
            request.run.snapshot.command && task.session.messages.length === 0 ? 'command' : 'user',
        });
        if (execution.abort)
          return { stopped: true, error: '', sessionFile: task.session.sessionFile };
        const version = policyVersion;
        await memory.runWithPolicy(
          () => request.run.snapshot.memory && !paused && policyVersion === version,
          () =>
            task!.session.prompt(
              request.run.snapshot.input.text ||
                (request.run.snapshot.command
                  ? `Run ${request.run.snapshot.command.name}.`
                  : 'Use the attached context.'),
              { expandPromptTemplates: false },
            ),
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
        running = null;
      }
    }
    case 'messages': {
      const task = sessions.get(request.taskId);
      if (task) return projectTranscript(task.session.messages);
      if (!request.sessionFile) return [];
      const manager = SessionManager.open(
        request.sessionFile,
        path.join(root, 'agent', 'sessions', request.taskId),
        homedir(),
      );
      return projectTranscript(
        manager
          .getBranch()
          .filter((entry) => entry.type === 'message')
          .map((entry) => entry.message),
      );
    }
    case 'stop':
      if (running?.id === request.runId) {
        running.abort = true;
        cancelQuestions(request.runId);
        const session = sessions.get(running.taskId)?.session;
        if (session) await session.abort();
      }
      return null;
    case 'answer':
      answerWorker(request.requestId, request.answer);
      return null;
    case 'memory':
      return memory.list();
    case 'pause':
      policyVersion++;
      paused = request.paused;
      for (const task of sessions.values())
        task.session.setActiveToolsByName(toolNames(task.current, !paused));
      return null;
    case 'memoryUpdate':
      policyVersion++;
      return memory.update(request.entry, request.content);
    case 'forget':
      const forgotten = sessions.get(request.taskId);
      if (forgotten) {
        await forgotten.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'new' });
        forgotten.session.dispose();
      }
      sessions.delete(request.taskId);
      return null;
    case 'shutdown':
      policyVersion++;
      paused = true;
      if (running) {
        cancelQuestions(running.id);
        await sessions.get(running.taskId)?.session.abort();
      }
      for (const task of sessions.values()) {
        await task.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
        task.session.dispose();
      }
      memory.close();
      return null;
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
