import {
  deleteComputerBinding,
  getComputerProgress,
  getComputerStatus,
  getUnresolvedComputerFacts,
  resolveComputerFacts,
  stopAllComputer,
} from '@atd/agent-client';
import type { ComputerBridge, ComputerShellState } from '../client/computer-contract';
import type { NativeBridge } from '../native-bridge/client';
import type { NativeConnection } from './native-connection';

/**
 * Browser and computer use over the relay and the native bridge. The shell sends `computer.state`
 * as soon as the page is ready, so this subscribes before the host's first await and replays the
 * latest state to each listener. A prepared target reaches the service from the shell itself;
 * the page only learns its id, and lists change through `onChange` (a host state change, a
 * finished prepare, a reconnect), since the service sends no invalidation for targets.
 */
export function nativeComputer(connection: NativeConnection, native: NativeBridge): ComputerBridge {
  const options = () => connection.options();
  let latest: ComputerShellState | null = null;
  const stateListeners = new Set<(state: ComputerShellState) => void>();
  const changeListeners = new Set<() => void>();
  const changed = () => {
    for (const listener of changeListeners) listener();
  };
  native.on('computer.state', (state) => {
    latest = state;
    for (const listener of stateListeners) listener(state);
    changed();
  });
  return {
    applicationIcon: async (bundleId) => {
      const { pngBase64 } = await native.call('computer.applicationIcon', { bundleId });
      return pngBase64 === null ? null : `data:image/png;base64,${pngBase64}`;
    },
    listApplications: async () => (await native.call('computer.listApplications', {})).applications,
    status: () => getComputerStatus(options()),
    removeBinding: (bindingId) => deleteComputerBinding(options(), bindingId),
    stopAll: () => stopAllComputer(options()),
    progress: async (taskId) => (await getComputerProgress(options(), taskId)).progress,
    onProgress: (listener) => connection.onComputerProgress(listener),
    onState: (listener) => {
      stateListeners.add(listener);
      if (latest) listener(latest);
      return () => void stateListeners.delete(listener);
    },
    showPreview: (taskId) => native.call('computer.preview.show', { taskId }),
    onChange: (listener) => {
      changeListeners.add(listener);
      const stopConnected = connection.onConnected(listener);
      return () => {
        changeListeners.delete(listener);
        stopConnected();
      };
    },
    prepareBrowser: async (request) => {
      const result = await native.call('computer.prepareBrowser', request);
      changed();
      return result;
    },
    prepareApplication: async (request) => {
      const result = await native.call('computer.prepareApplication', request);
      changed();
      return result;
    },
    unresolvedFacts: async (taskId) =>
      (await getUnresolvedComputerFacts(options(), taskId)).actionIds,
    resolveFacts: (request) => resolveComputerFacts(options(), request),
    primeCaptureConsent: () => native.call('computer.primeCaptureConsent', {}),
    acknowledgeUnsettled: async (actionIds) =>
      void (await native.call('computer.acknowledgeUnsettled', { actionIds })),
    openProfile: async (bindingId) =>
      void (await native.call('computer.openProfile', { bindingId })),
    setPointerVisible: async (visible) =>
      void (await native.call('computer.setPointerVisible', { visible })),
    setTyping: async (setting, enabled) =>
      void (await native.call('computer.setTyping', { setting, enabled })),
    pickApp: async () => (await native.call('apps.pick', {})).apps[0] ?? null,
  };
}
