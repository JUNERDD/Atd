/**
 * T5 subagent authority barrel. TaskRunner and pi-session import from this
 * module only; all delegation logic lives in `subagents/*` (each ≤350).
 */
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { SessionFactoryDeps } from '../pi-session.js';
import type { RunBinding } from '../run-binding.js';
import type { ChildModelRuntime } from './registry.js';

/** Lifecycle and transcript readers need no delegator until a parent session opens. */
export async function prepareSubagentsParent(
  deps: SessionFactoryDeps,
  binding: Pick<RunBinding, 'agents' | 'mcp'>,
  childRuntime: ChildModelRuntime,
): Promise<ExtensionFactory> {
  const { prepareSubagentsParent: prepare } = await import('./delegator.js');
  return prepare(deps, binding, childRuntime);
}
export {
  abortSubagentsForTask,
  disposeSubagentsForTask,
  rebindSubagentsForRun,
} from './lifecycle.js';
export {
  DISABLED_SUBAGENT_FEATURES,
  ensureManagedSubagentConfig,
  readManagedSubagentConfig,
  auditManagedConfig,
  subagentConfigPath,
  managedSubagentConfig,
} from './config.js';
export {
  registerParent,
  parentByTask,
  parentBySession,
  taskIdFromCwd,
  tryTrackChildStart,
  trackChildEnd,
  liveChildren,
  markParentStopping,
  isParentStopping,
  tryAcquireWrite,
  releaseWrite,
  forgetTaskTree,
  storeHost,
  hostForTask,
} from './registry.js';
export { intersectChildTools, isChildToolAllowed } from './intersection.js';
export {
  installManagedLaunchTrigger,
  pinManagedLaunch,
  abortTaskChildren,
  liveChildCount,
  isTriggerInstalled,
} from './trigger.js';
export { resolveRequiredExtensionPath, REQUIRED_EXTENSION_ID } from './required-extension.js';
export { guardSubagentCall, onSubagentResult } from './guard.js';
export { readChildTranscript } from './child-transcript-read.js';
