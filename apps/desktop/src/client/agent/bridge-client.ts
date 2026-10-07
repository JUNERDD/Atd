import type {
  AgentBridge,
  AgentEvent,
  AgentRequest,
  AutomationSessionTarget,
  CommandLaunch,
  CommandSession,
  ExtensionSession,
} from './bridge';

/** What each push channel of the agent bridge carries. */
export interface AgentChannelValues {
  changed: AgentEvent;
  launch: CommandLaunch;
  session: CommandSession;
  automationSession: AutomationSessionTarget;
  extensionSession: ExtensionSession;
}
export type AgentChannel = keyof AgentChannelValues;

export type AgentListen = <C extends AgentChannel>(
  channel: C,
  listener: (value: AgentChannelValues[C]) => void,
) => () => void;

/**
 * The agent bridge over a transport: the host (`native-host`) hands each request to the shared
 * request handler. The transport answers `unknown`; each method states the result its request
 * produces, the one place that contract is asserted.
 */
export function createAgentBridge(
  transport: (request: AgentRequest) => Promise<unknown>,
  listen: AgentListen,
): AgentBridge {
  const invoke = <T>(request: AgentRequest) => transport(request) as Promise<T>;
  return {
    get: () => invoke({ action: 'get' }),
    detail: (taskId) => invoke({ action: 'detail', taskId }),
    saveCommand: (command, expectedRevision) =>
      invoke({ action: 'saveCommand', command, expectedRevision }),
    deleteCommand: (commandId, revision) =>
      invoke({ action: 'deleteCommand', commandId, revision }),
    launch: (commandId, prepared) =>
      invoke({ action: 'launch', commandId, prepared: prepared ?? null }),
    prepareWithText: (commandId, text) => invoke({ action: 'prepareWithText', commandId, text }),
    prepare: (commandId) => invoke({ action: 'prepare', commandId }),
    capture: (source) => invoke({ action: 'capture', source }),
    preview: (input, command, policy = null) =>
      invoke({ action: 'preview', input, command, policy }),
    submit: (request) => invoke({ action: 'submit', ...request }),
    stop: (taskId, runId) => invoke({ action: 'stop', taskId, runId }),
    answer: (taskId, runId, requestId, answer) =>
      invoke({ action: 'answer', taskId, runId, requestId, answer }),
    queueMessage: (taskId, text, mode) => invoke({ action: 'queueMessage', taskId, text, mode }),
    replaceQueue: (taskId, followUp) => invoke({ action: 'replaceQueue', taskId, followUp }),
    setPermissionTier: (taskId, tier) => invoke({ action: 'setPermissionTier', taskId, tier }),
    renameTask: (taskId, title) => invoke({ action: 'renameTask', taskId, title }),
    deleteTask: (taskId) => invoke({ action: 'deleteTask', taskId }),
    compactTask: (taskId, instructions) =>
      invoke({
        action: 'compactTask',
        taskId,
        ...(instructions === undefined ? {} : { instructions }),
      }),
    contextBreakdown: (taskId) => invoke({ action: 'contextBreakdown', taskId }),
    forkTask: (taskId, entryId, title) =>
      invoke({ action: 'forkTask', taskId, entryId, ...(title === undefined ? {} : { title }) }),
    chooseFiles: () => invoke({ action: 'chooseFiles' }),
    saveFile: (name, content) => invoke({ action: 'saveFile', name, content }),
    memory: () => invoke({ action: 'memory' }),
    saveMemorySettings: (settings) => invoke({ action: 'saveMemorySettings', settings }),
    createMemoryUnit: (input) => invoke({ action: 'createMemoryUnit', input }),
    saveMemoryUnit: (input) => invoke({ action: 'saveMemoryUnit', input }),
    deleteMemoryUnit: (id) => invoke({ action: 'deleteMemoryUnit', id }),
    toggleMemoryUnit: (id, enabled) => invoke({ action: 'toggleMemoryUnit', id, enabled }),
    markMemoryUnitReviewed: (id) => invoke({ action: 'markMemoryUnitReviewed', id }),
    acceptMemoryProposal: (id) => invoke({ action: 'acceptMemoryProposal', id }),
    dismissMemoryProposal: (id) => invoke({ action: 'dismissMemoryProposal', id }),
    artifact: (artifactId, operation) => invoke({ action: 'artifact', artifactId, operation }),
    copy: (text) => invoke({ action: 'copy', text }),
    openLink: (url) => invoke({ action: 'openLink', url }),
    childTranscript: (taskId, childKey) => invoke({ action: 'childTranscript', taskId, childKey }),
    releaseChildTranscript: (taskId, childKey) =>
      invoke({ action: 'releaseChildTranscript', taskId, childKey }),
    onChange: (listener) => listen('changed', listener),
    onLaunch: (listener) => listen('launch', listener),
    onCommandSession: (listener) => listen('session', listener),
    onAutomationSession: (listener) => listen('automationSession', listener),
    onExtensionSession: (listener) => listen('extensionSession', listener),
  };
}
