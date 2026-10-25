import type { ImageContent } from '@earendil-works/pi-ai';
import type { ViewInitiative } from '@atd/agent-contracts';
import type { RunFolder } from './folders/material.js';
import { EMPTY_RUN_MEMORY, type RunMemory } from './memory/run-memory.js';
import type { LoadedSkill } from './skills/run-skills.js';
import { EMPTY_SKILL_CATALOG, type RunSkillCatalog } from './skills/skill-catalog.js';

/** A text file; its content goes into the run material. */
export interface RunTextAttachment {
  kind: 'text';
  name: string;
  path: string;
  text: string;
}

/**
 * An image file. It reaches the model as image input with the run's prompt (task-runner.ts), so
 * the run material only names it (and notes how it was scaled).
 */
export interface RunImageAttachment {
  kind: 'image';
  name: string;
  path: string;
  image: ImageContent;
  /** How the image was scaled, when it was, so the model can map coordinates back. */
  note?: string;
}

export type RunAttachment = RunTextAttachment | RunImageAttachment;

/** Material a run injects before its first turn: its instructions, files, references and skills. */
export interface RunMaterial {
  instructions: string;
  attachments: RunAttachment[];
  /** The task's granted folders as the run started: read-only material and read roots. */
  folders: RunFolder[];
  /**
   * The passages the run's message quotes and what its `@` references resolved to at freeze
   * (references/material.ts); may be empty.
   */
  references: string;
  /** Skills captured at freeze, sent in a message of their own (skills/session-skills.ts). */
  skills: LoadedSkill[];
  /** The skills the model is told about and may load (skills/session-catalog.ts, load-skill-tool.ts). */
  catalog: RunSkillCatalog;
  /** The memory sections frozen with the run (memory/run-memory.ts, memory/session-memory.ts). */
  memory: RunMemory;
  /** Whether the run has the `computer` tool, decided at freeze (computer/tool-set.ts). */
  computer: boolean;
  /**
   * How readily the model shows views, as the stored setting stood when the run started
   * (views/initiative.ts). Null for a lite run, which has no view tools, and before a runner's
   * first run; without a level the model is told nothing about views.
   */
  viewInitiative: ViewInitiative | null;
}

/** The material before a runner's first run; a run replaces it before its session is bound. */
export const NO_RUN_MATERIAL: RunMaterial = {
  instructions: '',
  attachments: [],
  folders: [],
  references: '',
  skills: [],
  catalog: EMPTY_SKILL_CATALOG,
  memory: EMPTY_RUN_MEMORY,
  computer: false,
  viewInitiative: null,
};
