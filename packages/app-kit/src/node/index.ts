/**
 * `@atd/app-kit/node`: what the agent service uses to stage, typecheck and build generated apps
 * and to launch their backends, each inside its own Seatbelt profile. Build order:
 * `prepareStaging` → `typecheckApp` (non-blocking) and `buildApp` → publish `outDir` as a version
 * → `backendSpawnSpec` per start, after `selfCheckSandbox` passed once.
 */
export {
  BUILD_TIMEOUT_MS,
  buildApp,
  type BuildAppOptions,
  type BuildError,
  type BuildErrorCode,
  type BuildResult,
} from './build.js';
export { backendSpawnSpec, type BackendSpawnOptions, type BackendSpawnSpec } from './backend.js';
export { selfCheckSandbox, type SandboxSelfCheck, type SelfCheckOptions } from './self-check.js';
export {
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  prepareStaging,
  type StagedApp,
  type StagingError,
  type StagingErrorCode,
  type StagingResult,
} from './staging.js';
export {
  TYPECHECK_TIMEOUT_MS,
  typecheckApp,
  type TypecheckDiagnostic,
  type TypecheckOptions,
  type TypecheckResult,
} from './typecheck.js';
export { SERVER_PACKAGES, WEB_PACKAGES, loadToolchain, type Toolchain } from './toolchain.js';
