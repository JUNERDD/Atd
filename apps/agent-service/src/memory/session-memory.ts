import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { RunMemory } from './run-memory.js';

/** System prompt sections of a run's memory; Pi wraps each in a tag of its name. */
export const MEMORY_POLICY_SECTION = 'memory_policy';
export const MEMORY_CORE_SECTION = 'memory_core';
export const MEMORY_INDEX_SECTION = 'memory_index';

/**
 * Tells the model about the current run's frozen memory (run-memory.ts) through system prompt
 * sections, set only when they have text: none when the run has memory off, and no core or index
 * when it has nothing to show. Like the skill catalog (skills/session-catalog.ts), Pi rebuilds
 * the sections for every prompt, and persists a system prompt patch only when one differs from
 * what is already in context, so unchanged memory keeps the prompt prefix as it was. A section
 * that did change, after a memory write between prompts, is appended as such a patch in full, so
 * a long task carries the earlier copies until compaction, as with the skill catalog. Registered
 * after the skill catalog, the sections render after `skill_catalog`, the most volatile last.
 */
export function sessionMemory(memory: () => RunMemory): ExtensionFactory {
  return (pi) => {
    pi.on('before_agent_start', (event) => {
      const { policyText, coreText, indexText } = memory();
      const { sections } = event.systemPromptOptions;
      if (policyText) sections[MEMORY_POLICY_SECTION] = policyText;
      if (coreText) sections[MEMORY_CORE_SECTION] = coreText;
      if (indexText) sections[MEMORY_INDEX_SECTION] = indexText;
    });
  };
}
