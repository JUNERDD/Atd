import { Compile } from 'typebox/compile';
import {
  CONFIGURE_MCP_TOOL,
  TODO_TOOL,
  ToolBlockDetailsSchema,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  type ToolBlockDetails,
} from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import { SUBAGENT_TOOL } from '../subagents/tool-contract.js';
import { projectEditDetails } from './edit.js';
import { projectMcpApprovalDetails } from './mcp-approval.js';
import { projectSubagentDetails, type SubagentDetailsInput } from './subagent.js';
import { projectTodoDetails } from './todo.js';
import { projectWebFetchDetails, projectWebSearchDetails } from './web.js';

type Projector = (raw: unknown) => ToolBlockDetails | undefined;

/** Compiled once: live projection checks every detailed row on each reprojection. */
const ToolBlockDetailsValidator = Compile(ToolBlockDetailsSchema);

/**
 * Per-tool projectors from a result's raw `details` (Pi `ToolResultMessage.details`, untrusted
 * JSON) to the whitelisted `ServiceBlock` details. Tools missing here never carry details, except
 * launching `subagent` calls (`projectSubagentToolDetails`), whose cards need more than the result.
 */
const PROJECTORS: ReadonlyMap<string, Projector> = new Map<string, Projector>([
  [TODO_TOOL, projectTodoDetails],
  ['edit', projectEditDetails],
  [WEB_SEARCH_TOOL, projectWebSearchDetails],
  [WEB_FETCH_TOOL, projectWebFetchDetails],
  [CONFIGURE_MCP_TOOL, projectMcpApprovalDetails],
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

/**
 * Details for a launching `subagent` call in any status (subagent.ts); the one tool whose running
 * and failed rows carry details too, because its cards track children the call started.
 */
export function projectSubagentToolDetails(
  input: SubagentDetailsInput,
  log?: Pick<Logger, 'debug'>,
): ToolBlockDetails | undefined {
  return checked(SUBAGENT_TOOL, projectSubagentDetails(input), log);
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
