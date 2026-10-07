import {
  AgentClientError,
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomationRuns,
  listAutomations,
  markAutomationRunsRead,
  patchAutomationSettings,
  previewAutomationTrigger,
  runAutomation,
  setAutomationEnabled,
  updateAutomation,
} from '@atd/agent-client';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { AUTOMATION_RUN_HISTORY, AutomationTriggerProblemSchema } from '@atd/agent-contracts';
import {
  AutomationConflictError,
  AutomationProblemError,
  type AutomationsBridge,
} from '../client/automations-contract';
import type { NativeBridge } from '../native-bridge/client';
import type { NativeConnection } from './native-connection';
import type { WindowMessages } from './window-messages';

/** The codes a refused save or switch names (`AutomationStatus['problem']`). */
const ProblemSchema = Type.Union([
  AutomationTriggerProblemSchema,
  Type.Literal('commandUnavailable'),
  Type.Literal('folderUnavailable'),
  Type.Literal('modelUnavailable'),
]);

/**
 * Failures pages tell apart by type: a 409 means the automation moved on (or already runs), and a
 * 400 that names a problem code ("Invalid automation (inPast): …") is worded by the page.
 */
async function typed<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (!(error instanceof AgentClientError)) throw error;
    if (error.status === 409) throw new AutomationConflictError(error.message);
    const code = /^Invalid automation \(([A-Za-z]+)\)/.exec(error.message)?.[1];
    if (error.status === 400 && Value.Check(ProblemSchema, code))
      throw new AutomationProblemError(code, error.message);
    throw error;
  }
}

/**
 * The automations bridge over the relay. Every window reloads its lists on the `automations`
 * invalidation and when the service reconnects; the shell alone posts the notifications.
 */
export function nativeAutomations(
  connection: NativeConnection,
  native: NativeBridge,
  messages: WindowMessages,
): AutomationsBridge {
  const options = () => connection.options();
  return {
    list: () => listAutomations(options()),
    get: (id) => getAutomation(options(), id),
    create: (draft) => typed(createAutomation(options(), draft)),
    update: (id, expectedRevision, automation) =>
      typed(updateAutomation(options(), id, { expectedRevision, automation })),
    setEnabled: (id, enabled, expectedRevision) =>
      typed(
        setAutomationEnabled(options(), id, {
          enabled,
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
        }),
      ),
    remove: (id) => deleteAutomation(options(), id),
    run: async (id) => (await typed(runAutomation(options(), id))).run,
    runs: async (id) => (await listAutomationRuns(options(), id, AUTOMATION_RUN_HISTORY)).runs,
    preview: (request) => previewAutomationTrigger(options(), request),
    markRead: (request) => markAutomationRunsRead(options(), request),
    setPaused: async (paused) => void (await patchAutomationSettings(options(), { paused })),
    pickFolder: () => native.call('files.pickFolder', {}),
    showTask: async (taskId) => {
      messages.post({ type: 'openTask', taskId });
      await native.call('window.show', {});
    },
    taskExists: async (taskId) => {
      try {
        await connection.http().summary(taskId);
        return true;
      } catch (error) {
        if (error instanceof AgentClientError && error.status === 404) return false;
        throw error;
      }
    },
    onChange: (listener) => {
      const stopInvalidate = connection.onInvalidate((frame) => {
        if (frame.scope === 'automations') listener();
      });
      const stopConnected = connection.onConnected(listener);
      return () => {
        stopInvalidate();
        stopConnected();
      };
    },
  };
}

/**
 * The tasks the shell asks the panel to show (`task.open`, sent when the person opens an
 * automation's notification). The shell queues the event until the page is ready, which can be
 * before the panel's view subscribes, so the latest request waits for the first subscriber.
 * Subscribe it before the host's first await so no delivery is missed.
 */
export function nativeTaskOpen(native: NativeBridge) {
  const listeners = new Set<(taskId: string) => void>();
  let waiting: string | null = null;
  native.on('task.open', ({ taskId }) => {
    waiting = listeners.size ? null : taskId;
    for (const listener of listeners) listener(taskId);
  });
  return (listener: (taskId: string) => void) => {
    listeners.add(listener);
    if (waiting !== null) {
      const taskId = waiting;
      waiting = null;
      listener(taskId);
    }
    return () => void listeners.delete(listener);
  };
}
