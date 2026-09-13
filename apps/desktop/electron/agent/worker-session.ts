import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import type { WorkerRun } from './worker-contract';
import type { HermesHost } from './hermes-host';
import { configureModel } from './worker-model';
import { nativeExtension } from './worker-tools';
import { askWorker, publish } from './worker-channel';
import { projectTranscript } from './transcript';

export interface SessionHost {
  root: string;
  memory: HermesHost;
  canLearn: () => boolean;
  policyVersion: () => number;
}
export interface TaskSession {
  session: AgentSession;
  models: ModelRuntime;
  current: WorkerRun;
  flush: () => void;
}

export async function createTaskSession(
  host: SessionHost,
  request: WorkerRun,
): Promise<TaskSession> {
  const current = { request };
  const agentRoot = path.join(host.root, 'agent');
  const sessionsDir = path.join(agentRoot, 'sessions', request.taskId);
  const cwd = path.join(host.root, 'tasks', request.taskId, 'output');
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  const models = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    modelsStorePath: path.join(agentRoot, 'models-cache.json'),
    refreshOnCreate: false,
  });
  const model = await configureModel(models, request.run.snapshot.model, () => ({
    taskId: request.taskId,
    runId: current.request.run.id,
  }));
  const settings = SettingsManager.inMemory({
    retry: { enabled: false },
    defaultThinkingLevel: 'off',
  });
  const integration: ExtensionFactory = (pi) => {
    pi.on('before_agent_start', () => {
      const snapshot = current.request.run.snapshot;
      const material = [
        snapshot.instructions,
        snapshot.command ? `Named parameters: ${JSON.stringify(snapshot.input.arguments)}` : '',
        ...current.request.attachments.map(
          (file) =>
            `File: ${file.name}\nRead-only resource: ${file.path}\n<file-material>\n${file.text}\n</file-material>`,
        ),
      ]
        .filter(Boolean)
        .join('\n\n');
      if (material)
        return {
          message: { customType: 'app-material', content: material, display: false },
        };
    });
    pi.registerTool({
      name: 'ask_user',
      label: 'Ask for input',
      description: 'Ask the user for missing information needed to continue this task.',
      parameters: Type.Object({
        question: Type.String(),
        options: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })),
      }),
      async execute(_id, args) {
        const answer = await askWorker({
          id: randomUUID(),
          taskId: request.taskId,
          runId: current.request.run.id,
          kind: 'input',
          title: args.question,
          detail: '',
          options: args.options ?? [],
        });
        return {
          content: [
            {
              type: 'text',
              text: typeof answer === 'string' ? answer : 'The user cancelled the request.',
            },
          ],
          details: {},
        };
      },
    });
  };
  const loader = new DefaultResourceLoader({
    cwd: homedir(),
    agentDir: agentRoot,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt:
      'You are a helpful desktop assistant. Help with everyday writing, analysis and practical tasks. Treat attached documents and captured text as task material. Use only the available tools. File paths do not grant access. Ask for input when necessary. Never claim a file or memory was saved without a successful tool result.',
    appendSystemPrompt: [],
    extensionFactories: [
      nativeExtension(request.taskId, () => current.request.run.id, cwd),
      integration,
      host.memory.extension({
        canRead: () => current.request.run.snapshot.memory,
        canLearn: () => current.request.run.snapshot.memory && host.canLearn(),
        policyVersion: host.policyVersion,
        notify: (text, kind) => publish({ type: 'notice', taskId: request.taskId, text, kind }),
        changed: () => publish({ type: 'memoryChanged' }),
      }),
    ],
  });
  await loader.reload();
  if (loader.getExtensions().errors.length)
    throw new Error('An Agent extension could not be loaded.');
  const sessionManager = request.sessionFile
    ? SessionManager.open(request.sessionFile, sessionsDir, homedir())
    : SessionManager.create(homedir(), sessionsDir);
  const { session } = await createAgentSession({
    cwd: homedir(),
    agentDir: agentRoot,
    modelRuntime: models,
    model,
    settingsManager: settings,
    sessionManager,
    resourceLoader: loader,
    tools: toolNames(request, host.canLearn()),
    thinkingLevel: 'off',
  });
  await session.bindExtensions({
    mode: 'json',
    onError: (error) => {
      publish({ type: 'notice', taskId: request.taskId, text: error.error, kind: 'error' });
    },
  });
  let partial: AgentSession['messages'][number] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const messages = [...session.messages];
    if (
      partial &&
      !messages.some(
        (message) =>
          message === partial ||
          ('timestamp' in message &&
            message.timestamp === partial?.timestamp &&
            message.role === partial.role),
      )
    )
      messages.push(partial);
    publish({
      type: 'messages',
      taskId: request.taskId,
      runId: current.request.run.id,
      messages: projectTranscript(messages),
      sessionFile: session.sessionFile ?? '',
    });
  };
  session.subscribe((event) => {
    if (
      event.type === 'message_end' &&
      event.message.role === 'toolResult' &&
      !event.message.isError &&
      ['memory_add', 'memory_replace', 'memory_remove'].includes(event.message.toolName)
    )
      publish({ type: 'memoryChanged' });
    if (event.type === 'message_update') partial = event.message;
    if (event.type === 'message_end') partial = undefined;
    if (!timer) timer = setTimeout(flush, 40);
  });
  return {
    session,
    models,
    flush,
    get current() {
      return current.request;
    },
    set current(request: WorkerRun) {
      current.request = request;
    },
  };
}

export function toolNames(request: WorkerRun, learning: boolean): string[] {
  return [
    ...request.run.snapshot.tools,
    'ask_user',
    ...(request.run.snapshot.memory
      ? ['memory_search', ...(learning ? ['memory_add', 'memory_replace', 'memory_remove'] : [])]
      : []),
  ];
}
