import { readFile } from 'node:fs/promises';
import { atomicWrite } from '../config.js';
import type { SkillProfilePaths } from './profile.js';
import { runSkillRefs, type SkillRefInput } from './versions.js';

/**
 * Next-run staging. SubmitTaskRequest carries only what acceptance freezes, so
 * skill/role selection for the next run is staged per task and consumed once at run freeze. Staging
 * never mutates an accepted run; unreleased staging applies to the next run.
 */
export interface TaskStaging {
  skills: SkillRefInput[];
  roleId?: string;
  stagedAt: string;
}

interface PendingFile {
  version: 1;
  tasks: Record<string, TaskStaging>;
}

function pendingFile(profile: SkillProfilePaths): string {
  return `${profile.profileDir}/pending.json`;
}

async function readPending(profile: SkillProfilePaths): Promise<PendingFile> {
  try {
    return JSON.parse(await readFile(pendingFile(profile), 'utf8')) as PendingFile;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { version: 1, tasks: {} };
    throw new Error('Skill staging could not be read. The original file is preserved.');
  }
}

/** Stages skill/role selection for the next run of a task, as the run will request it. */
export async function stageTaskSkills(
  profile: SkillProfilePaths,
  taskId: string,
  skills: SkillRefInput[],
  roleId?: string,
): Promise<TaskStaging> {
  const file = await readPending(profile);
  const staging: TaskStaging = {
    skills: runSkillRefs(skills),
    roleId,
    stagedAt: new Date().toISOString(),
  };
  file.tasks[taskId] = staging;
  await atomicWrite(pendingFile(profile), file);
  return staging;
}

/** Reads staged selection without consuming it (for UI preview). */
export async function peekTaskStaging(
  profile: SkillProfilePaths,
  taskId: string,
): Promise<TaskStaging | null> {
  return (await readPending(profile)).tasks[taskId] ?? null;
}

/** Takes staged selection once at run freeze; repeats get empty staging. */
export async function takeTaskStaging(
  profile: SkillProfilePaths,
  taskId: string,
): Promise<TaskStaging> {
  const file = await readPending(profile);
  const staging = file.tasks[taskId] ?? {
    skills: [],
    stagedAt: new Date(0).toISOString(),
  };
  delete file.tasks[taskId];
  await atomicWrite(pendingFile(profile), file);
  return staging;
}
