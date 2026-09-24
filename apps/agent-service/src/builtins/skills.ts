import path from 'node:path';
import { ConflictError } from '../errors.js';
import { atdHome } from '../service-fs.js';
import type { SkillDiagnostic } from '../skills/diagnostics.js';
import { fingerprintDir } from './fingerprint.js';
import { backupDir, clearWorkDir, installDirAtomic, present } from './install-dir.js';
import {
  BUILTIN_SKILLS,
  builtinSkillsTemplateDir,
  builtinStatus,
  reconcileAction,
  type BuiltinEntry,
  type BuiltinStatus,
} from './manifest.js';
import { readInstallState, recordInstall, withBuiltinLock, type InstallRecord } from './state.js';

/** Where product skills come from and go to. Defaults to the shipped templates and `atdHome()`. */
export interface BuiltinSkillsContext {
  atdHome: string;
  templateRoot: string;
}

/** Product-skill statuses by skill name, and why any could not be reconciled. */
export interface BuiltinSkillsReport {
  statuses: Map<string, BuiltinStatus>;
  diagnostics: SkillDiagnostic[];
}

function defaultContext(): BuiltinSkillsContext {
  return { atdHome: atdHome(), templateRoot: builtinSkillsTemplateDir() };
}

/**
 * Layout under the ATD home: copies in `skills/<name>`, install records in `.builtins.json`,
 * staging in `.builtins-staging/`, restore backups in `backups/skills/` (outside `skills/`, where
 * they would be discovered as duplicate skills).
 */
function layout(ctx: BuiltinSkillsContext) {
  return {
    skillsDir: path.join(ctx.atdHome, 'skills'),
    stateFile: path.join(ctx.atdHome, '.builtins.json'),
    workDir: path.join(ctx.atdHome, '.builtins-staging'),
    backupRoot: path.join(ctx.atdHome, 'backups', 'skills'),
  };
}

/**
 * Reconciles every product skill whose template this build ships (see `reconcileAction`): installs
 * absent ones, upgrades untouched ones, records identical ones, and keeps changed ones as they
 * are. Idempotent and serialized per ATD home; a skill that fails is reported and the others go on.
 */
export function reconcileBuiltinSkills(
  ctx: BuiltinSkillsContext = defaultContext(),
): Promise<BuiltinSkillsReport> {
  return withBuiltinLock(ctx.atdHome, async () => {
    const paths = layout(ctx);
    await clearWorkDir(paths.workDir);
    const recorded = await readInstallState(paths.stateFile);
    const report: BuiltinSkillsReport = { statuses: new Map(), diagnostics: [] };
    for (const entry of BUILTIN_SKILLS) {
      try {
        const status = await reconcileSkill(ctx, entry, recorded[entry.id]);
        if (status) report.statuses.set(entry.name, status);
      } catch (error) {
        report.diagnostics.push(failure(entry, path.join(paths.skillsDir, entry.name), error));
      }
    }
    return report;
  });
}

/**
 * Restores one product skill to the shipped version: a copy that differs from it is first backed
 * up to `backups/skills/<name>-<UTC stamp>/`, then the shipped directory is installed atomically
 * and recorded. Answers the backup path, or null when the copy was absent or already identical.
 */
export function restoreBuiltinSkill(
  entry: BuiltinEntry,
  ctx: BuiltinSkillsContext = defaultContext(),
): Promise<{ backupPath: string | null; builtin: BuiltinStatus }> {
  return withBuiltinLock(ctx.atdHome, async () => {
    const paths = layout(ctx);
    const template = await templateOf(ctx, entry);
    if (!template)
      throw new ConflictError(`Built-in skill "${entry.name}" is not shipped with this build.`);
    await clearWorkDir(paths.workDir);
    const target = path.join(paths.skillsDir, entry.name);
    const copy = await fingerprintDir(target);
    const backupPath =
      copy !== null && copy !== template.fingerprint
        ? await backupDir(target, paths.backupRoot, entry.name)
        : null;
    if (copy !== template.fingerprint)
      await installDirAtomic({ source: template.dir, target, workDir: paths.workDir });
    const record = await recordInstall(paths.stateFile, entry, template.fingerprint);
    return {
      backupPath,
      builtin: builtinStatus(entry, template.fingerprint, template.fingerprint, record),
    };
  });
}

async function reconcileSkill(
  ctx: BuiltinSkillsContext,
  entry: BuiltinEntry,
  recorded: InstallRecord | undefined,
): Promise<BuiltinStatus | null> {
  const template = await templateOf(ctx, entry);
  if (!template) return null;
  const paths = layout(ctx);
  const target = path.join(paths.skillsDir, entry.name);
  const copy = await fingerprintDir(target);
  const action = reconcileAction(entry, copy, template.fingerprint, recorded);
  if (action === 'keep' && copy !== null)
    return builtinStatus(entry, copy, template.fingerprint, recorded);
  if (action === 'install')
    await installDirAtomic({ source: template.dir, target, workDir: paths.workDir });
  const record =
    action === 'none'
      ? recorded
      : await recordInstall(paths.stateFile, entry, template.fingerprint);
  return builtinStatus(entry, template.fingerprint, template.fingerprint, record);
}

/**
 * The shipped template directory of a product skill and its fingerprint, or null when this build
 * does not ship it (no SKILL.md): the manifest may list a skill before its template lands.
 */
async function templateOf(
  ctx: BuiltinSkillsContext,
  entry: BuiltinEntry,
): Promise<{ dir: string; fingerprint: string } | null> {
  const dir = path.join(ctx.templateRoot, entry.name);
  if (!(await present(path.join(dir, 'SKILL.md')))) return null;
  const fingerprint = await fingerprintDir(dir);
  return fingerprint ? { dir, fingerprint } : null;
}

function failure(entry: BuiltinEntry, target: string, error: unknown): SkillDiagnostic {
  const reason = error instanceof Error ? error.message : 'unknown error';
  return {
    type: 'error',
    code: 'invalid_skill',
    message: `Built-in skill "${entry.name}" could not be installed or upgraded: ${reason}`,
    skill: entry.name,
    path: target.slice(0, 4096),
  };
}
