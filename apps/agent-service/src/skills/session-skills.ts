import {
  buildContextEntries,
  type CompactionEntry,
  type ExtensionFactory,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent';
import { CONTEXT_BUDGET } from '../tasks/run-budget.js';
import type { LoadedSkill } from './run-skills.js';
import {
  loadMessage,
  readCarriedSkills,
  reattachMessage,
  type SkillBlock,
} from './skill-message.js';

/**
 * Characters of earlier skills one compaction brings back, filled from the most recently loaded
 * skill. A skill that does not fit whole stays out: half of its instructions would mislead.
 */
const REATTACH_CHARS = CONTEXT_BUDGET / 2;

export interface SessionSkillsHost {
  /** The run the session executes now; a session outlives the run that built it. */
  runId: () => string;
  /** That run's skills, captured at its freeze. */
  skills: () => readonly LoadedSkill[];
}

/**
 * Brings skills to the model as hidden `app-skill` messages, so the user text keeps its `/skill:`
 * markers as plain position hints. A run's captured skills go in once, with its prompt. When a
 * compaction removes earlier skill messages or `load_skill` results from context, their skills are
 * re-attached from those entries, not from skill files: the revisions they came from may be pruned
 * or edited by then.
 */
export function sessionSkills(host: SessionSkillsHost): ExtensionFactory {
  return (pi) => {
    let injectedRun = '';
    pi.on('before_agent_start', () => {
      const runId = host.runId();
      const skills = host.skills();
      // Every prompt the session sends raises this event, extension prompts included.
      if (runId === injectedRun || !skills.length) return;
      injectedRun = runId;
      return { message: loadMessage(runId, skills) };
    });
    pi.on('session_compact', (event, ctx) => {
      const skills = droppedSkills(ctx.sessionManager.getEntries(), event.compactionEntry);
      if (!skills.length) return;
      // An overflow retry resumes the interrupted turn right away, and steering reaches that very
      // request. Otherwise the message is appended without starting a turn: at once when idle, or
      // when the running turn ends, so the turns after it see the skills.
      pi.sendMessage(
        reattachMessage(host.runId(), skills),
        event.willRetry ? { deliverAs: 'steer' } : { triggerTurn: false },
      );
    });
  };
}

/**
 * Skills whose carrying entries the compaction took out of context: `app-skill` messages and
 * successful `load_skill` results (readCarriedSkills) in the context just before it (built at its
 * parent entry) but not after it. A skill a kept entry still carries is not repeated, and a skill
 * loaded more than once comes back in its latest version.
 */
function droppedSkills(entries: SessionEntry[], compaction: CompactionEntry): SkillBlock[] {
  const after = buildContextEntries(entries, compaction.id);
  const kept = new Set(after.map((entry) => entry.id));
  const loaded = new Set(after.flatMap((entry) => readCarriedSkills(entry)).map((s) => s.name));
  const latest = new Map<string, SkillBlock>();
  for (const entry of buildContextEntries(entries, compaction.parentId)) {
    if (kept.has(entry.id)) continue;
    for (const skill of readCarriedSkills(entry)) {
      if (loaded.has(skill.name)) continue;
      // Deleting first moves a repeated name to its latest position.
      latest.delete(skill.name);
      latest.set(skill.name, skill);
    }
  }
  const chosen: SkillBlock[] = [];
  let room = REATTACH_CHARS;
  for (const skill of [...latest.values()].reverse()) {
    if (skill.block.length > room) continue;
    room -= skill.block.length;
    chosen.unshift(skill);
  }
  return chosen;
}
