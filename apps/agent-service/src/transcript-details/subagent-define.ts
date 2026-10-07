import { Compile } from 'typebox/compile';
import {
  SUBAGENT_AGENT_ENTRY,
  SubagentAgentEntrySchema,
  type SubagentAgentEntry,
  type SubagentDefineDetails,
} from '@atd/agent-contracts';

/**
 * A `subagent { action: "define" }` row: the task agents the call recorded. The parent session's
 * `app-agent` entries, one per accepted definition with the call's id (subagents/task-agents.ts),
 * are the only record of them; the call's result text is written for the model.
 */

/** Compiled once: every live reprojection checks each record on the branch. */
const SubagentAgentEntryValidator = Compile(SubagentAgentEntrySchema);

/** A session record's `app-agent` entry; null for another record type or a malformed entry. */
export function agentEntryOf(customType: string, data: unknown): SubagentAgentEntry | null {
  return customType === SUBAGENT_AGENT_ENTRY && SubagentAgentEntryValidator.Check(data)
    ? data
    : null;
}

/**
 * True for a call that defines task agents. Transcripts keep the model's raw arguments, so this
 * reads them as given, like `isSubagentLaunch`.
 */
export function isSubagentDefine(args: Record<string, unknown>): boolean {
  return args['action'] === 'define';
}

/** The definitions a define call recorded, in entry order, without the entries' own fields. */
export function projectSubagentDefineDetails(
  entries: readonly SubagentAgentEntry[],
): SubagentDefineDetails {
  return {
    type: 'subagentDefine',
    agents: entries.map(({ agent, description, instructions, tools, thinking }) => ({
      agent,
      description,
      instructions,
      tools: [...tools],
      thinking,
    })),
  };
}
