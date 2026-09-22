import { diagnoseCapabilityDenied, type SkillDiagnostic } from './diagnostics.js';
import type { CapabilitySnapshotRecord } from './roles.js';

/**
 * Capability checks against the frozen snapshot. Text skills need no tools
 * and pass with an empty requirement; script skills list their tools, which
 * are shown for authorization and checked here. Install declarations, skill
 * text, annotations and profile text grant nothing — only the snapshot does.
 */
export interface SkillExecutionCheck {
  allowed: boolean;
  grantedTools: string[];
  deniedTools: string[];
  diagnostics: SkillDiagnostic[];
}

/** Checks one skill's requested tools against the frozen capability snapshot. */
export function checkSkillExecution(
  snapshot: CapabilitySnapshotRecord,
  skillName: string,
  requestedTools: string[],
): SkillExecutionCheck {
  const granted = new Set(snapshot.tools);
  const grantedTools = requestedTools.filter((tool) => granted.has(tool));
  const deniedTools = requestedTools.filter((tool) => !granted.has(tool));
  return {
    allowed: deniedTools.length === 0,
    grantedTools,
    deniedTools,
    diagnostics: deniedTools.map((tool) => diagnoseCapabilityDenied(skillName, tool)),
  };
}

/** Text skills never auto-enable read/bash; they execute with zero tools. */
export function checkTextSkill(snapshot: CapabilitySnapshotRecord, skillName: string): boolean {
  void snapshot;
  void skillName;
  return true;
}

/** Whether a skill name is in the frozen capability snapshot at all. */
export function isSkillAllowed(snapshot: CapabilitySnapshotRecord, skillName: string): boolean {
  return snapshot.skills.includes(skillName);
}
