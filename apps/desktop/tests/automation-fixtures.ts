import { vi } from 'vitest';
import type {
  Automation,
  AutomationItem,
  AutomationListResponse,
  AutomationRun,
  AutomationStatus,
} from '@atd/agent-contracts';
import type { AgentBridge } from '../src/client/agent/bridge';
import { emptyInput, type AgentTask, type RunStatus } from '../src/client/agent/task-schema';
import type { AutomationsBridge } from '../src/client/automations-contract';
import type { ServiceStatusView } from '../src/client/service/ipc';
import { bridgeKeys } from '../src/lib/bridge-cache';
import { queryClient } from '../src/lib/query-client';

/** The Mac's zone, which a schedule's summary leaves unnamed. */
export const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * A saved automation: a daily prompt at nine on the Mac's clock unless `fields` say otherwise.
 * Its status names no folders; pass `status.folders` for one that uses some.
 */
export function automationItem(
  fields: Partial<Automation> & Pick<Automation, 'id' | 'name'>,
  status: Partial<AutomationStatus> = {},
): AutomationItem {
  return {
    automation: {
      revision: 1,
      enabled: true,
      trigger: {
        kind: 'schedule',
        schedule: { kind: 'daily', time: '09:00' },
        timezone: systemZone,
      },
      action: { kind: 'prompt', prompt: 'Summarize what arrived in my inbox.' },
      policy: {
        permissionTier: 'manual',
        memory: true,
        folderIds: [],
        maxDurationMinutes: 30,
        missedRuns: 'runOnce',
      },
      delivery: { notify: 'whenNew', includePreviousResult: true },
      createdBy: 'user',
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
      ...fields,
    },
    status: { folders: [], unread: 0, running: false, ...status },
  };
}

/** A run record as Run now answers it. */
export function automationRun(fields: Partial<AutomationRun> & Pick<AutomationRun, 'id'>) {
  const run: AutomationRun = {
    automationId: 'morning',
    source: 'manual',
    firedAt: '2026-10-06T01:00:00.000Z',
    outcome: 'running',
    ...fields,
  };
  return run;
}

/**
 * An automations bridge over an in-memory list: writes change the list and report the change as
 * the `automations` invalidation would, so pages reload from it.
 */
export function fakeAutomations(
  initial: AutomationItem[],
  options: { paused?: boolean; problem?: string } = {},
) {
  let list: AutomationListResponse = {
    automations: initial,
    paused: options.paused ?? false,
    ...(options.problem ? { problem: options.problem } : {}),
  };
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  const find = (id: string) => {
    const item = list.automations.find(({ automation }) => automation.id === id);
    if (!item) throw new Error(`Automation ${id} was not found.`);
    return item;
  };
  const replace = (next: AutomationItem) => {
    list = {
      ...list,
      automations: list.automations.map((item) =>
        item.automation.id === next.automation.id ? next : item,
      ),
    };
    changed();
    return structuredClone(next);
  };
  const bridge = {
    list: vi.fn(async () => structuredClone(list)),
    get: vi.fn(async (id: string) => structuredClone(find(id))),
    create: vi.fn(async (draft: Parameters<AutomationsBridge['create']>[0]) => {
      const item = automationItem({ ...draft, id: 'created' });
      list = { ...list, automations: [...list.automations, item] };
      changed();
      return structuredClone(item);
    }),
    update: vi.fn(
      async (id: string, revision: number, draft: Parameters<AutomationsBridge['update']>[2]) => {
        const item = find(id);
        return replace({
          ...item,
          automation: { ...item.automation, ...draft, revision: revision + 1 },
        });
      },
    ),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => {
      const item = find(id);
      return replace({ ...item, automation: { ...item.automation, enabled } });
    }),
    remove: vi.fn(async (id: string) => {
      list = {
        ...list,
        automations: list.automations.filter(({ automation }) => automation.id !== id),
      };
      changed();
    }),
    run: vi.fn(async (id: string) => automationRun({ id: 'run-now', automationId: id })),
    runs: vi.fn(async (): Promise<AutomationRun[]> => []),
    preview: vi.fn(async (): Promise<Awaited<ReturnType<AutomationsBridge['preview']>>> => ({
      nextRuns: [],
    })),
    markRead: vi.fn(async () => {}),
    setPaused: vi.fn(async (paused: boolean) => {
      list = { ...list, paused };
      changed();
    }),
    pickFolder: vi.fn(async (): Promise<Awaited<ReturnType<AutomationsBridge['pickFolder']>>> => ({
      folders: [],
      failures: [],
    })),
    showTask: vi.fn(async () => {}),
    taskExists: vi.fn(async (_taskId: string) => true),
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  } satisfies AutomationsBridge;
  return bridge;
}

/**
 * Adds `automations` to the installed desktop bridge and reports the service as connected, which
 * the automation reads wait for. Call after `installBridge`.
 */
export function installAutomations(bridge: AutomationsBridge) {
  const desktop = window.desktop;
  if (!desktop) throw new Error('Install the desktop bridge first.');
  window.desktop = { ...desktop, automations: bridge };
  const connected: ServiceStatusView = {
    state: 'connected',
    detail: '',
    serviceId: 'test',
    epoch: 1,
    draining: false,
    activeRuns: 0,
    pendingConfirms: 0,
    pendingCapabilities: 0,
    dataDir: null,
    baseUrl: null,
    stream: { epoch: 1, seq: 0 },
  };
  queryClient.setQueryData(bridgeKeys.serviceStatus, connected);
}

/** A task an automation started, with one run in `status` (none for `null`). */
export function automationTask(
  id: string,
  automationId: string,
  status: RunStatus | null = 'completed',
): AgentTask {
  const now = '2026-10-06T01:00:00.000Z';
  return {
    id,
    title: `Run of ${automationId}`,
    createdAt: now,
    updatedAt: now,
    sessionFile: null,
    legacy: null,
    permissionTier: 'auto',
    origin: { kind: 'automation', automationId },
    runs: status
      ? [
          {
            id: `${id}-run`,
            invocationId: `${id}-invocation`,
            createdAt: now,
            status,
            error: '',
            snapshot: {
              command: null,
              definition: 'current',
              input: emptyInput(),
              instructions: '',
              model: {
                connectionId: 'test',
                modelId: 'test-model',
                provider: 'openai',
                baseUrl: 'https://api.openai.com/v1',
              },
              tools: [],
              memory: true,
            },
          },
        ]
      : [],
  };
}

/** Makes the agent bridge's task list `tasks` from now on (installBridge starts with none). */
export function withTasks(api: AgentBridge, tasks: AgentTask[]) {
  const get = api.get;
  api.get = async () => ({ ...(await get()), tasks: structuredClone(tasks) });
}
