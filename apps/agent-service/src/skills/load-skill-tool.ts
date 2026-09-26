import { LOAD_SKILL_TOOL } from '@ai/agent-contracts';
import type { ExtensionFactory, SessionEntry } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { CONTEXT_BUDGET } from '../tasks/run-budget.js';
import { readSkillBody } from './resources.js';
import type { RunSkillCatalog } from './skill-catalog.js';
import {
  readCarriedSkills,
  skillBlock,
  skillRevision,
  type LoadSkillDetails,
} from './skill-message.js';

/** Largest SKILL.md body one load brings into context. */
const MAX_LOAD_CHARS = CONTEXT_BUDGET / 4;

export interface LoadSkillHost {
  /** The current run's catalog, frozen with it; a session outlives the run that built it. */
  catalog: () => RunSkillCatalog;
}

/**
 * `load_skill`: loads one skill of the current run's catalog into context on the model's request.
 * The result carries the skill's block, rendered like a `/` selection's (skill-message.ts), so the
 * compaction re-attach and the dedupe read it through readCarriedSkills. Reading an installed,
 * enabled skill's own instructions is read-only, so no gate applies. Parent sessions only: the run
 * binding allows it when the catalog lists a loadable skill (run-binding.ts), and children never
 * inherit it (subagents/intersection.ts).
 */
export function loadSkillTool(host: LoadSkillHost): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: LOAD_SKILL_TOOL,
      label: 'Load skill',
      description:
        "Load the instructions of one skill from this app's skill catalog, by its name. Use it only when the task clearly matches the skill's description, and not for a skill already loaded in this conversation.",
      // Catalog names reach 128 characters (atd-skills.ts, user-agents.ts); the catalog decides.
      parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 128 }) }),
      executionMode: 'sequential',
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const { name } = params;
        const catalog = host.catalog();
        if (catalog.userOnly.some((skill) => skill.name === name))
          throw new Error(
            `Skill "${name}" can only be started by the user. Ask the user to select it by typing / in the composer.`,
          );
        const skill = catalog.invocable.find((item) => item.name === name);
        if (!skill) throw new Error(`Skill "${name}" is not in the skill catalog.`);
        const carried = ctx.sessionManager
          .buildContextEntries()
          .some((entry) => readCarriedSkills(entry).some((item) => item.name === name));
        if (carried)
          return {
            content: [
              {
                type: 'text',
                text: `Skill "${name}" is already loaded in this conversation; follow its instructions there.`,
              },
            ],
            details: { name, alreadyLoaded: true },
          };
        let body: string;
        try {
          body = await readSkillBody(skill.entry);
        } catch {
          throw new Error(
            `Skill "${name}" could not be read: it changed or was removed. Ask the user to select it again.`,
          );
        }
        if (body.length > MAX_LOAD_CHARS)
          throw new Error(
            `Skill "${name}" is too large to load (${body.length} characters; the limit is ${MAX_LOAD_CHARS}).`,
          );
        const details: LoadSkillDetails = {
          name,
          revision: skillRevision(body),
          baseDir: skill.baseDir,
        };
        const block = skillBlock(
          { name, location: skill.entry, baseDir: skill.baseDir, companionOf: null },
          body,
        );
        return { content: [{ type: 'text', text: block }], details };
      },
    });
  };
}

/**
 * Directories of the current catalog's skills that session context carries (readCarriedSkills),
 * so files next to a skill loaded with `load_skill` read like a `/` selection's. Derived from the
 * entries, so it holds after a rebuild from the session file and after a compaction re-attach.
 */
export function loadedSkillDirs(
  catalog: RunSkillCatalog,
  entries: readonly SessionEntry[],
): string[] {
  const carried = new Set(entries.flatMap((entry) => readCarriedSkills(entry)).map((s) => s.name));
  return catalog.invocable.filter((skill) => carried.has(skill.name)).map((skill) => skill.baseDir);
}
