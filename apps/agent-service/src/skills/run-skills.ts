import { createHash } from 'node:crypto';
import { errorMessage, type TaskRun } from '@ai/agent-contracts';
import { CONTEXT_BUDGET, runInputSize } from '../tasks/run-budget.js';
import { diagnoseNotRunAvailable, type SkillDiagnostic } from './diagnostics.js';
import { readSkillBody } from './resources.js';
import type { CapabilitySnapshotRecord } from './roles.js';
import { contentChars, loadMessage, skillBlock, type SkillBlock } from './skill-message.js';
import type { SkillSnapshotRecord } from './versions.js';

/** A skill a run loads. */
export interface LoadedSkill extends SkillBlock {
  /** The skill's directory (parent of SKILL.md): its references resolve here, and the run may read it. */
  baseDir: string;
}

/** A run's skills as its freeze captured them. */
export interface RunSkills {
  /** What the run injects, in first-occurrence order, each with the body read at freeze. */
  loaded: LoadedSkill[];
  /** Frozen skills the run leaves out: its role does not allow them, or SKILL.md is unreadable. */
  diagnostics: SkillDiagnostic[];
}

/**
 * Captures the skills a run may use: the frozen skills its capability snapshot keeps (requested ∩
 * role allows ∩ not revoked, skills/roles.ts). Each body is read once, here, and hashed as the run's
 * revision of that skill. The run injects exactly this content, so a skill file edited after the
 * freeze, or a revision pruned once the run is released, never changes what the run saw. A
 * companion (skills/companions.ts) is marked with the skill that declares it, and stays out when
 * that skill does not load: it serves no request on its own.
 */
export async function captureRunSkills(
  snapshot: SkillSnapshotRecord,
  capabilities: CapabilitySnapshotRecord,
): Promise<RunSkills> {
  const allowed = new Set(capabilities.skills);
  const companionOf = new Map((snapshot.companions ?? []).map((ref) => [ref.name, ref.of]));
  const loaded: LoadedSkill[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  for (const record of snapshot.skills) {
    const declaredBy = companionOf.get(record.name) ?? null;
    const declarerMissing =
      declaredBy !== null && !loaded.some((skill) => skill.name === declaredBy);
    if (!allowed.has(record.name) || declarerMissing) {
      diagnostics.push(diagnoseNotRunAvailable(record.name, capabilities.runId));
      continue;
    }
    let body: string;
    try {
      body = await readSkillBody(record.entry);
    } catch (error) {
      diagnostics.push({
        type: 'error',
        code: 'invalid_skill',
        message: `Skill "${record.name}" could not be read: ${errorMessage(error)}`,
        skill: record.name,
        path: record.entry,
      });
      continue;
    }
    loaded.push({
      name: record.name,
      revision: createHash('sha256').update(body).digest('hex').slice(0, 32),
      baseDir: record.baseDir,
      block: skillBlock(
        {
          name: record.name,
          location: record.entry,
          baseDir: record.baseDir,
          companionOf: declaredBy,
        },
        body,
      ),
    });
  }
  return { loaded, diagnostics };
}

/** Characters the run's skill message puts into context; they come out of the budget before references. */
export function skillChars(runId: string, skills: readonly LoadedSkill[]): number {
  return skills.length ? contentChars(loadMessage(runId, skills)) : 0;
}

/**
 * Why a run cannot start with its skills, or null. A skill chip the run cannot load fails it by
 * name, and so do skills that leave the message no room in the context budget. Chip skills are the
 * `skill` chips of the run's input (the composer stages exactly those); any other staged skill came
 * from a saved command, and when one is missing the freeze diagnostics record it without failing.
 */
export function runSkillsError(run: TaskRun, skills: readonly LoadedSkill[]): string | null {
  const loaded = new Set(skills.map((skill) => skill.name));
  const chips = (run.snapshot.input.chips ?? []).flatMap(({ chip }) =>
    chip.kind === 'skill' ? [chip.name] : [],
  );
  const missing = [...new Set(chips)].filter((name) => !loaded.has(name));
  if (missing.length) {
    const names = missing.map((name) => `"${name}"`).join(', ');
    return missing.length === 1
      ? `Skill ${names} is not available to this run.`
      : `Skills ${names} are not available to this run.`;
  }
  const chars = skillChars(run.id, skills);
  if (runInputSize(run.snapshot) + chars > CONTEXT_BUDGET)
    return `The selected skills (${chars} characters) and the message exceed the context budget of ${CONTEXT_BUDGET} characters. Remove a skill or shorten the message.`;
  return null;
}
