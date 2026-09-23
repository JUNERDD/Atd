/**
 * T3 skills/roles authority barrel. T34int imports from this module only;
 * no other service file is touched by the T3/T34int integration.
 */
export {
  skillProfilePaths,
  ensureSkillProfile,
  controlledSubprocessEnv,
  withConfinedSkillEnv,
  createManagedSettings,
  type SkillProfilePaths,
} from './profile.js';
export { buildSkillLoaderOptions } from './loader.js';
export { ConfinedSkillPackages } from './package-manager.js';
export {
  listRevisions,
  listCurrent,
  publishRevision,
  resolveRef,
  freezeRunSkills,
  loadRunSnapshot,
  releaseRun,
  type SkillRevisionRecord,
  type SkillRefInput,
  type SkillSnapshotRecord,
} from './versions.js';
export {
  diagnoseInvalidRef,
  fromPiDiagnostic,
  mapPiDiagnostics,
  diagnoseSameName,
  diagnoseMissingPackage,
  diagnoseUpdateAvailable,
  diagnoseStaleRevision,
  diagnoseNotRunAvailable,
  diagnoseHarnessDisabled,
  diagnoseCapabilityDenied,
  type SkillDiagnostic,
} from './diagnostics.js';
export {
  listRoles,
  putRole,
  resolveRole,
  freezeRoleSnapshot,
  freezeCapabilitySnapshot,
  freezeRunRole,
  loadRunRole,
  type RoleRecord,
  type RoleSnapshotRecord,
  type CapabilitySnapshotRecord,
} from './roles.js';
export { checkSkillExecution, checkTextSkill, isSkillAllowed } from './capability-check.js';
export { stageTaskSkills, peekTaskStaging, takeTaskStaging } from './staging.js';
export {
  listSkills,
  setSkillEnabled,
  getSkill,
  installSkill,
  updateSkill,
  stageSkills,
  peekStaging,
  freezeRun,
  releaseRunHandler,
  listRolesHandler,
  putRoleHandler,
  previewSkillExecution,
  type SkillRouteDeps,
} from './routes.js';
