import type { ResourceDiagnostic } from '@earendil-works/pi-coding-agent';

/**
 * T3-owned diagnostic codes. Pi diagnostics are preserved verbatim in
 * `message`; the `code` makes same-name/invalid/update/missing handling
 * explicit for the service without rewriting the Pi loader.
 */
export interface SkillDiagnostic {
  type: 'warning' | 'error' | 'collision';
  code:
    | 'same_name'
    | 'invalid_ref'
    | 'invalid_skill'
    | 'missing_package'
    | 'update_available'
    | 'stale_revision'
    | 'not_run_available'
    | 'capability_denied'
    | 'harness_disabled';
  message: string;
  skill?: string;
  path?: string;
  winnerPath?: string;
  loserPath?: string;
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Validates a skill reference name without touching the filesystem. */
export function diagnoseInvalidRef(name: string): SkillDiagnostic | null {
  if (NAME_PATTERN.test(name)) return null;
  return {
    type: 'error',
    code: 'invalid_ref',
    message: `Invalid skill name "${name}".`,
    skill: name.slice(0, 128),
  };
}

/** Maps one Pi resource diagnostic to a service skill diagnostic. */
export function fromPiDiagnostic(diagnostic: ResourceDiagnostic): SkillDiagnostic {
  if (diagnostic.collision)
    return {
      type: 'collision',
      code: 'same_name',
      message: diagnostic.message,
      path: diagnostic.path,
      winnerPath: diagnostic.collision.winnerPath,
      loserPath: diagnostic.collision.loserPath,
      skill: diagnostic.collision.name.slice(0, 128),
    };
  return {
    type: diagnostic.type === 'collision' ? 'collision' : diagnostic.type,
    code: 'invalid_skill',
    message: diagnostic.message,
    path: diagnostic.path,
  };
}

export function mapPiDiagnostics(diagnostics: ResourceDiagnostic[]): SkillDiagnostic[] {
  return diagnostics.map(fromPiDiagnostic);
}

/**
 * Same-name collision across installed revisions: the winner keeps serving
 * the run, the loser is reported and never silently merged.
 */
export function diagnoseSameName(
  name: string,
  winnerPath: string,
  loserPath: string,
): SkillDiagnostic {
  return {
    type: 'collision',
    code: 'same_name',
    message: `Skill "${name}" is installed twice; "${winnerPath}" wins.`,
    skill: name,
    winnerPath,
    loserPath,
  };
}

/**
 * Missing package: the managed service path does not exist. Callers must
 * return this instead of falling back to `npm root -g` or the user profile.
 */
export function diagnoseMissingPackage(source: string, managedPath: string): SkillDiagnostic {
  return {
    type: 'error',
    code: 'missing_package',
    message: `Package "${source}" is not installed in the service profile (${managedPath}).`,
    path: managedPath,
  };
}

/** Update published: the active run keeps the old revision until next run. */
export function diagnoseUpdateAvailable(
  name: string,
  currentRevision: string,
  nextRevision: string,
): SkillDiagnostic {
  return {
    type: 'warning',
    code: 'update_available',
    message:
      `Skill "${name}" has revision ${nextRevision}; ` +
      `the active run keeps ${currentRevision} until the next run.`,
    skill: name,
  };
}

/** Stale revision requested after an update published a newer one. */
export function diagnoseStaleRevision(name: string, revision: string): SkillDiagnostic {
  return {
    type: 'warning',
    code: 'stale_revision',
    message: `Skill "${name}" revision ${revision} is superseded; it stays valid for its frozen runs.`,
    skill: name,
  };
}

/** Explicit `/skill:name` for a skill outside the frozen run snapshot. */
export function diagnoseNotRunAvailable(name: string, runId: string): SkillDiagnostic {
  return {
    type: 'error',
    code: 'not_run_available',
    message: `Skill "${name}" is not available to run ${runId}.`,
    skill: name,
  };
}

/** Skill stays on disk; the harness will not offer it to a run. */
export function diagnoseHarnessDisabled(name: string): SkillDiagnostic {
  return {
    type: 'error',
    code: 'harness_disabled',
    message: `Skill "${name}" is turned off for this harness.`,
    skill: name,
  };
}

/** Script skill tool outside the frozen capability snapshot. */
export function diagnoseCapabilityDenied(skill: string, tool: string): SkillDiagnostic {
  return {
    type: 'error',
    code: 'capability_denied',
    message: `Skill "${skill}" requests "${tool}", which the run is not authorized for.`,
    skill,
  };
}
