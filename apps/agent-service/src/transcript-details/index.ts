import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { Compile } from 'typebox/compile';
import {
  CODEMODE_TOOL,
  CONFIGURE_MCP_TOOL,
  TODO_TOOL,
  ToolBlockDetailsSchema,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  type ServiceToolStatus,
  type SubagentAgentEntry,
  type SubagentChildEntry,
  type ToolBlockDetails,
} from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import { APP_TOOL } from '../apps/tool-name.js';
import { isSubagentLaunch, SUBAGENT_TOOL } from '../subagents/tool-contract.js';
import { projectAppDetails } from './app.js';
import { projectCodemodeDetails, type CodemodeDetailsInput, type StepList } from './codemode.js';
import { projectEditDetails } from './edit.js';
import { projectMcpApprovalDetails } from './mcp-approval.js';
import { projectSubagentDetails, subagentRows, type SubagentRow } from './subagent.js';
import { isSubagentDefine, projectSubagentDefineDetails } from './subagent-define.js';
import { projectTodoDetails } from './todo.js';
import { projectWebFetchDetails, projectWebSearchDetails } from './web.js';

type Projector = (raw: unknown) => ToolBlockDetails | undefined;

/** Compiled once: live projection checks every detailed row on each reprojection. */
const ToolBlockDetailsValidator = Compile(ToolBlockDetailsSchema);

/**
 * Per-tool projectors from a result's raw `details` (Pi `ToolResultMessage.details`, untrusted
 * JSON) to the whitelisted `ServiceBlock` details. Tools missing here never carry details, except
 * `subagent` and `codemode` calls, whose rows need more than the result (`projectBlockDetails`).
 */
const PROJECTORS: ReadonlyMap<string, Projector> = new Map<string, Projector>([
  [TODO_TOOL, projectTodoDetails],
  ['edit', projectEditDetails],
  [WEB_SEARCH_TOOL, projectWebSearchDetails],
  [WEB_FETCH_TOOL, projectWebFetchDetails],
  [CONFIGURE_MCP_TOOL, projectMcpApprovalDetails],
  [APP_TOOL, projectAppDetails],
]);

/**
 * Details for one successfully completed tool call; the caller passes only non-error results.
 * The projected object is checked against the contract before it leaves the service, so a
 * projector bug drops the details (the row falls back to the output text) instead of
 * publishing a block the desktop would reject.
 */
export function projectToolDetails(
  tool: string,
  raw: unknown,
  log?: Pick<Logger, 'debug'>,
): ToolBlockDetails | undefined {
  const project = PROJECTORS.get(tool);
  if (!project || raw === undefined) return undefined;
  const details = project(raw);
  return details ? checked(tool, details, log) : undefined;
}

/** One tool call of an assistant message, as its block reports it (transcript-blocks.ts). */
export interface DetailsCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ServiceToolStatus;
  result: ToolResultMessage | undefined;
}

/**
 * What a block's details come from besides its own call: the branch's app records by call id
 * (transcript-blocks.ts `BlockLookups`) and the live state of calls still running
 * (live-transcript.ts).
 */
export interface DetailsSources {
  lookups: {
    /** `app-child` entries by the launching `subagent` call id, in `seq` order. */
    children: ReadonlyMap<string, readonly SubagentChildEntry[]>;
    /** `app-agent` entries by the defining `subagent` call id, in entry order. */
    agents: ReadonlyMap<string, readonly SubagentAgentEntry[]>;
    /** Recorded permission outcomes by tool call id. */
    permissions: CodemodeDetailsInput['permissions'];
  };
  /** Latest streamed result rows of running `subagent` calls, by call id. */
  subagentProgress: ReadonlyMap<string, readonly SubagentRow[]>;
  /** Steps of running `codemode` calls, by call id. */
  codemodeProgress: ReadonlyMap<string, StepList>;
  log?: Pick<Logger, 'debug'> | undefined;
}

/**
 * Raw result details stop here: a tool gets the whitelisted projection once completed, with three
 * exceptions. A launching `subagent` call carries its child cards in every status, because they
 * track children the call started (subagent.ts). A `codemode` call does too: its nested calls show
 * as rows while the script runs, and a failed script keeps the calls it made before it failed
 * (codemode.ts). A `subagent` define call shows the definitions its `app-agent` entries recorded
 * once it completed (subagent-define.ts); one that recorded none has none.
 */
export function projectBlockDetails(
  call: DetailsCall,
  sources: DetailsSources,
): ToolBlockDetails | undefined {
  const { id, name, args, status, result } = call;
  const { lookups, log } = sources;
  if (name === SUBAGENT_TOOL && isSubagentLaunch(args)) {
    const rows = result ? subagentRows(result.details) : (sources.subagentProgress.get(id) ?? []);
    const children = lookups.children.get(id) ?? [];
    return checked(name, projectSubagentDetails({ args, status, children, rows }), log);
  }
  if (name === SUBAGENT_TOOL && isSubagentDefine(args)) {
    const entries = status === 'completed' ? (lookups.agents.get(id) ?? []) : [];
    return entries.length ? checked(name, projectSubagentDefineDetails(entries), log) : undefined;
  }
  if (name === CODEMODE_TOOL) {
    const live = sources.codemodeProgress.get(id);
    const { permissions } = lookups;
    return checked(name, projectCodemodeDetails({ status, result, live, permissions }), log);
  }
  return result && status === 'completed'
    ? projectToolDetails(name, result.details, log)
    : undefined;
}

function checked(
  tool: string,
  details: ToolBlockDetails,
  log?: Pick<Logger, 'debug'>,
): ToolBlockDetails | undefined {
  const { type } = details;
  if (ToolBlockDetailsValidator.Check(details)) return details;
  // Debug level: live projection reruns on every streamed delta and would repeat the entry.
  log?.debug('Dropped tool details that failed the contract.', { tool, type });
  return undefined;
}
