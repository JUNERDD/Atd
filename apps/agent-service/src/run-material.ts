import type { ImageContent } from '@earendil-works/pi-ai';
import type { ViewInitiative } from '@atd/agent-contracts';
import type { ExtractionEntry } from './file-loader/extraction-store.js';
import type { RunFolder } from './folders/material.js';
import { EMPTY_RUN_MEMORY, type RunMemory } from './memory/run-memory.js';
import type { LoadedSkill } from './skills/run-skills.js';
import { EMPTY_SKILL_CATALOG, type RunSkillCatalog } from './skills/skill-catalog.js';

/**
 * Any file that is not image input: its loaded text (decoded text, a document's extracted text or
 * a description; file-loader/loader.ts) as the run material carries it, cut to the file's share of
 * the material budget with a note naming the line where `read` continues (file-loader/material.ts).
 */
export interface RunTextAttachment {
  kind: 'text';
  name: string;
  path: string;
  text: string;
  /**
   * The extraction entry that keeps the file's text and the files it names, when the run has a
   * tool that opens it (run-attachments.ts); the material names it beside the file.
   */
  entry?: ExtractionEntry;
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

/**
 * A file the run could not load (run-attachments.ts): the material names it with the reason, and
 * with no resource path, since its stored copy may be the part that is missing.
 */
export interface RunUnavailableAttachment {
  kind: 'unavailable';
  name: string;
  /** Why it was not loaded, in words for the model. */
  reason: string;
}

export type RunAttachment = RunTextAttachment | RunImageAttachment | RunUnavailableAttachment;

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
