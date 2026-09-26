import type { TextContent } from '@earendil-works/pi-ai';
import {
  buildContextEntries,
  type ExtensionFactory,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { RunSkillCatalog } from './skill-catalog.js';

/** Custom type of the hidden message that lists a run's skill catalog; transcripts never show it. */
export const APP_SKILL_CATALOG = 'app-skill-catalog';

const CatalogDetailsSchema = Type.Object({
  runId: Type.String(),
  digest: Type.String(),
  loadable: Type.Number(),
  userOnly: Type.Number(),
});

interface CatalogMessage {
  customType: typeof APP_SKILL_CATALOG;
  display: false;
  content: TextContent[];
  details: Static<typeof CatalogDetailsSchema>;
}

export interface SessionCatalogHost {
  /** The run the session executes now; a session outlives the run that built it. */
  runId: () => string;
  /** That run's catalog, frozen with it (skills/skill-catalog.ts). */
  catalog: () => RunSkillCatalog;
}

/**
 * Tells the model which skills exist through a hidden `app-skill-catalog` message. A run sends
 * its catalog with its prompt only when it differs from the latest catalog message still in the
 * session's context, read from the session entries, so a session rebuilt from its file sees the
 * same. When a compaction takes that message out of context, the current catalog is sent again,
 * the way skills/session-skills.ts re-attaches skills.
 */
export function sessionSkillCatalog(host: SessionCatalogHost): ExtensionFactory {
  return (pi) => {
    pi.on('before_agent_start', (_event, ctx) => {
      const catalog = host.catalog();
      // Every prompt the session sends raises this event; one already in context is not repeated.
      if (
        !catalog.text ||
        latestDigest(ctx.sessionManager.buildContextEntries()) === catalog.digest
      )
        return;
      return { message: catalogMessage(host.runId(), catalog) };
    });
    pi.on('session_compact', (event, ctx) => {
      const catalog = host.catalog();
      if (!catalog.text) return;
      const entries = ctx.sessionManager.getEntries();
      const before = latestDigest(buildContextEntries(entries, event.compactionEntry.parentId));
      const after = latestDigest(buildContextEntries(entries, event.compactionEntry.id));
      if (before === null || after === before) return;
      // Delivered like re-attached skills: steered into an overflow retry, otherwise appended
      // without starting a turn.
      pi.sendMessage(
        catalogMessage(host.runId(), catalog),
        event.willRetry ? { deliverAs: 'steer' } : { triggerTurn: false },
      );
    });
  };
}

function catalogMessage(runId: string, catalog: RunSkillCatalog): CatalogMessage {
  return {
    customType: APP_SKILL_CATALOG,
    display: false,
    content: [{ type: 'text', text: catalog.text }],
    details: {
      runId,
      digest: catalog.digest,
      loadable: catalog.invocable.length,
      userOnly: catalog.userOnly.length,
    },
  };
}

/** Digest of the latest catalog message among `entries`, or null when none is there. */
function latestDigest(entries: readonly SessionEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== 'custom_message' || entry.customType !== APP_SKILL_CATALOG) continue;
    if (Value.Check(CatalogDetailsSchema, entry.details)) return entry.details.digest;
  }
  return null;
}
