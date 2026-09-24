import { Value } from 'typebox/value';
import {
  TODO_TOOL,
  ToolBlockDetailsSchema,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  type ToolBlockDetails,
} from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import { projectEditDetails } from './edit.js';
import { projectTodoDetails } from './todo.js';
import { projectWebFetchDetails, projectWebSearchDetails } from './web.js';

type Projector = (raw: unknown) => ToolBlockDetails | undefined;

/**
 * Per-tool projectors from a result's raw `details` (Pi `ToolResultMessage.details`, untrusted
 * JSON) to the whitelisted `ServiceBlock` details. Tools missing here never carry details.
 */
const PROJECTORS: ReadonlyMap<string, Projector> = new Map<string, Projector>([
  [TODO_TOOL, projectTodoDetails],
  ['edit', projectEditDetails],
  [WEB_SEARCH_TOOL, projectWebSearchDetails],
  [WEB_FETCH_TOOL, projectWebFetchDetails],
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
  if (!details) return undefined;
  const { type } = details;
  if (Value.Check(ToolBlockDetailsSchema, details)) return details;
  // Debug level: live projection reruns on every streamed delta and would repeat the entry.
  log?.debug('Dropped tool details that failed the contract.', { tool, type });
  return undefined;
}
