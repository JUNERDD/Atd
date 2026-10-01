import type { AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { replacedTurnStart } from './tasks/turns.js';

/**
 * Moves a session branch to just before a replaced user message (`RunSnapshot.branchBefore`), so
 * the run that replaces it continues from there. The replaced turn stays in the session file on
 * the abandoned branch; nothing is summarized. The caller marks the new run's invocation right
 * after, so its marker is the first entry of the new branch and a reopened file (whose leaf is
 * its last entry) resumes there too.
 */

/**
 * Rewinds a manager no session is built on yet: `createAgentSession` then builds the agent context
 * and replays extension state (`session_start`) from the new branch.
 */
export function rewindManager(manager: SessionManager, entryId: string): void {
  moveLeaf(manager, replacedTurnStart(manager.getBranch(), entryId).parentId);
}

/**
 * Rewinds a live session between runs (a task's runs start one at a time, never during a manual
 * compaction, so nothing streams). Pi's `navigateTree` would move the leaf to a user message's
 * parent but cannot land on the parent of an invocation marker that follows a user message or
 * starts the file, so this takes its no-summary steps directly: move the leaf, rebuild the agent
 * messages from the new branch (`refreshContext`, the same refresh `navigateTree` ends with), and
 * tell extensions with `session_tree`, on which rpiv-todo replays its list and pi-subagents and
 * pi-web-access reselect their tools. The caller sets the run's tools after, which also stands in
 * for Pi's restore of the branch's recorded tools.
 */
export async function rewindSession(
  session: AgentSession,
  manager: SessionManager,
  entryId: string,
): Promise<void> {
  const oldLeafId = manager.getLeafId();
  moveLeaf(manager, replacedTurnStart(manager.getBranch(), entryId).parentId);
  session.refreshContext();
  await session.extensionRunner.emit({
    type: 'session_tree',
    newLeafId: manager.getLeafId(),
    oldLeafId,
  });
}

function moveLeaf(manager: SessionManager, leafId: string | null): void {
  if (leafId === null) manager.resetLeaf();
  else manager.branch(leafId);
}
