/**
 * `@atd/app-kit/node`: what the agent service uses to stage, typecheck and build generated apps
 * and to launch their backends, each inside its own Seatbelt profile. Build order:
 * `prepareStaging` → `prepareDependencies` (the declared npm packages, installed by npm in its own
 * sandbox) → `typecheckApp` (non-blocking) and `buildApp` → publish `outDir` as a version →
 * `backendSpawnSpec` per start, after `selfCheckSandbox` passed once. `pruneDependencyCache`
 * keeps the dependency cache within its limits.
 */
export {
  BUILD_TIMEOUT_MS,
  buildApp,
  type BuildAppOptions,
  type BuildError,
  type BuildErrorCode,
  type BuildResult,
  type DependenciesUsed,
} from './build.js';
export { backendSpawnSpec, type BackendSpawnOptions, type BackendSpawnSpec } from './backend.js';
export { pruneDependencyCache, type PruneResult } from './deps/cache.js';
export type { DeclaredDependencies } from './deps/declared.js';
export type { DependencyError, DependencyErrorCode } from './deps/errors.js';
export { MIN_RELEASE_AGE_DAYS, NPM_REGISTRY, npmSelfCheck, type NpmSelfCheck } from './deps/npm.js';
export {
  prepareDependencies,
  type DependencyTree,
  type PrepareDependenciesOptions,
  type PrepareDependenciesResult,
} from './deps/store.js';
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
export {
  PROVIDED_PACKAGES,
  SERVER_PACKAGES,
  TOOLCHAIN_PACKAGES,
  WEB_PACKAGES,
  loadToolchain,
  type Toolchain,
} from './toolchain.js';
