/**
 * T5 subagent authority barrel. TaskRunner and pi-session import from this
 * module only; all delegation logic lives in `subagents/*` (each ≤350).
 */
export { prepareSubagentsParent } from './delegator.js';
export {
  abortSubagentsForTask,
  disposeSubagentsForTask,
  rebindSubagentsForRun,
} from './lifecycle.js';
export {
  SUBAGENT_LIMITS,
  SERVICE_PARALLEL_WORKFLOW,
  SERVICE_CHAIN_WORKFLOW,
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
  validateParallelArgs,
  validateChainArgs,
  buildParallelScript,
  buildChainScript,
  resolveParallelResource,
  resolveChainResource,
} from './workflows.js';
export { serviceAgentNames, SERVICE_RUNTIME_AGENTS } from './agents.js';
export {
  installManagedSettingsTrigger,
  pinManagedSettings,
  abortTaskChildren,
  liveChildCount,
  isTriggerInstalled,
} from './trigger.js';
export { resolveRequiredExtensionPath, REQUIRED_EXTENSION_ID } from './required-extension.js';
export { guardSubagentCall, onSubagentResult } from './guard.js';
export { readChildTranscript } from './child-transcript-read.js';
