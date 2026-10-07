import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_AUTOMATIONS, type AppLanguage, type Automation } from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import { automationsDir, emptyAutomationState } from './files.js';
import { processTimeZone } from './schedule.js';
import type { AutomationStore } from './store.js';

/**
 * The automations every data dir gets once (`seedDefaultAutomations`), like the starter commands
 * (commands/starters.ts): they become the person's own, editable and deletable, and are never
 * restored after the seed. Today that is one: consolidating memory once a day when the Mac is
 * idle. Its name follows the stored language; the confirm and run texts stay English.
 */

/** Fixed, so a crash between the store write and the marker never adds it twice. */
export const DEFAULT_CONSOLIDATION_ID = 'default-memory-consolidation';

/** Two hours without input: long enough that the Mac is really unattended, not between tasks. */
const CONSOLIDATION_IDLE_MINUTES = 120;

const CONSOLIDATION_NAMES: Record<AppLanguage, string> = {
  en: 'Consolidate memory',
  'zh-CN': '整理记忆',
};

/** Run-once marker of the seed; its path is persisted data and stays fixed. */
export function defaultsMarker(dataDir: string): string {
  return path.join(automationsDir(dataDir), 'defaults.json');
}

function defaultAutomations(language: AppLanguage | null, now: number): Automation[] {
  const at = new Date(now).toISOString();
  return [
    {
      id: DEFAULT_CONSOLIDATION_ID,
      revision: 1,
      name: CONSOLIDATION_NAMES[language ?? 'en'],
      enabled: true,
      trigger: {
        kind: 'idle',
        idleMinutes: CONSOLIDATION_IDLE_MINUTES,
        timezone: processTimeZone(),
      },
      action: { kind: 'consolidateMemory' },
      policy: {
        permissionTier: 'auto',
        memory: true,
        folderIds: [],
        maxDurationMinutes: 15,
        missedRuns: 'skip',
      },
      delivery: { notify: 'whenNew', includePreviousResult: false },
      createdBy: 'user',
      createdAt: at,
      updatedAt: at,
    },
  ];
}

async function seeded(marker: string): Promise<boolean> {
  try {
    await readFile(marker);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Adds the default automations once per data dir, then writes the marker so one the person
 * deletes never returns. A store whose files could not be read is left alone without a marker,
 * so the next start tries again; a store that is full takes none, and the marker is written.
 */
export async function seedDefaultAutomations(
  dataDir: string,
  store: AutomationStore,
  options: { language: AppLanguage | null; now: number },
): Promise<void> {
  const marker = defaultsMarker(dataDir);
  if (store.problem || (await seeded(marker))) return;
  const added = await store.change((data) => {
    const held = new Set(data.definitions.automations.map((item) => item.id));
    const fresh = defaultAutomations(options.language, options.now).filter(
      (item) => !held.has(item.id),
    );
    const room = MAX_AUTOMATIONS - data.definitions.automations.length;
    const taken = fresh.slice(0, Math.max(0, room));
    for (const automation of taken) {
      data.definitions.automations.push(automation);
      data.state.automations[automation.id] = emptyAutomationState();
    }
    return taken.map((item) => item.id);
  });
  await atomicWrite(marker, { version: 1, seededAt: new Date(options.now).toISOString(), added });
}
