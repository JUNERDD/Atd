import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { RunSkillCatalog } from './skill-catalog.js';

/**
 * System prompt section that lists a run's skill catalog. Pi wraps it as `<skill_catalog>` and
 * must not share the name `skills`, which is Pi's own skills listing (disabled in this app).
 */
export const SKILL_CATALOG_SECTION = 'skill_catalog';

/**
 * Tells the model which skills exist through a system prompt section, never a message in the
 * user's turn: a hidden message after the prompt reads as more of the user's text, so a request
 * such as "translate the content below" took the catalog as content to translate.
 *
 * Pi rebuilds the section options for every prompt from an empty set, so every prompt sets the
 * section again; Pi persists a system prompt patch only when the text differs from the section
 * already in context, and a compaction keeps that system prompt. The handler stays registered
 * before the memory sections (memory/session-memory.ts), so they render after the catalog.
 */
export function sessionSkillCatalog(catalog: () => RunSkillCatalog): ExtensionFactory {
  return (pi) => {
    pi.on('before_agent_start', (event) => {
      const { text } = catalog();
      if (text) event.systemPromptOptions.sections[SKILL_CATALOG_SECTION] = text;
    });
  };
}
