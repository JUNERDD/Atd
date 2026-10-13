import type { AgentRequests } from '../client/agent/agent-requests';
import type { CommandProgressAction, LightCommandBridge, TaskDetail } from '../client/agent/bridge';
import type { NativeBridge } from '../native-bridge/client';

/**
 * The views that hold a task's transcript in the page (`TaskClient`): the panel's view, and one per
 * light command run, keyed by its write target, so such a run follows its task without moving the
 * panel off the task it shows.
 */
export type PageHolder = 'page' | `light:${string}`;

/**
 * Light command launches through the shell (`LightCommandBridge`): the run's task is held apart
 * from the panel's view, and its progress shows in the shell's progress HUD, whose presses come back as
 * `commandProgress.action`.
 */
export function nativeLightCommand(
  native: NativeBridge,
  requests: AgentRequests<PageHolder>,
): LightCommandBridge {
  const listeners = new Set<(action: CommandProgressAction) => void>();
  native.on('commandProgress.action', (action) => {
    for (const listener of listeners) listener(action);
  });
  return {
    // The request handler answers `unknown`; a submit resolves with the task's detail.
    submit: (key, request) =>
      requests.handle({ action: 'submit', ...request }, `light:${key}`) as Promise<TaskDetail>,
    release: (key) => requests.tasks.release(`light:${key}`),
    show: async (target, state) =>
      void (await native.call('commandProgress.show', { target, state })),
    hide: async (target) => void (await native.call('commandProgress.hide', { target })),
    onAction(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
