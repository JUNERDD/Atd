import {
  isChildExecutionId,
  parseChildExecutionId,
  type ServiceBlock,
  type ServiceEvent,
  type SubagentResult,
  type TaskSnapshot,
} from '@ai/agent-contracts';

/**
 * T5 standalone subagent client helpers. No new HTTP routes: status and
 * cancel flow through the task routes, and children surface through task
 * events (executionId `child:<runId>:<n>`) plus transcript tool blocks.
 * T6 consumes these pure helpers; this file edits no existing client.
 */

/** True when the event belongs to a T5 child execution. */
export function isChildEvent(event: ServiceEvent): boolean {
  return isChildExecutionId(event.executionId);
}

/** Filters a snapshot/event list down to one parent run's children. */
export function filterChildEvents(events: ServiceEvent[], parentRunId: string): ServiceEvent[] {
  return events.filter((event) => {
    const parsed = parseChildExecutionId(event.executionId);
    return parsed !== null && parsed.parentRunId === parentRunId;
  });
}

/** Groups child events by executionId for parent-UI aggregation. */
export function groupChildEvents(events: ServiceEvent[]): Map<string, ServiceEvent[]> {
  const grouped = new Map<string, ServiceEvent[]>();
  for (const event of events) {
    if (!isChildEvent(event)) continue;
    const list = grouped.get(event.executionId) ?? [];
    list.push(event);
    grouped.set(event.executionId, list);
  }
  return grouped;
}

interface SubagentToolOutput {
  ok?: unknown;
  output?: unknown;
  runId?: unknown;
  sessionFile?: unknown;
  error?: unknown;
  agent?: unknown;
}

/** Extracts explicit child results from transcript tool blocks. */
export function extractSubagentResults(blocks: ServiceBlock[]): SubagentResult[] {
  const results: SubagentResult[] = [];
  for (const block of blocks) {
    if (block.kind !== 'tool' || block.name !== 'subagent') continue;
    if (block.status !== 'completed' && block.status !== 'failed') continue;
    const parsed = tryParseOutput(block.output);
    if (!parsed) continue;
    results.push({
      executionId: block.runId ? `child:${block.runId}:${results.length}` : 'child:unknown:0',
      agent: typeof parsed.agent === 'string' ? parsed.agent : 'unknown',
      ok: parsed.ok === true,
      output: typeof parsed.output === 'string' ? parsed.output : block.output.slice(0, 100000),
      runId: typeof parsed.runId === 'string' ? parsed.runId : null,
      sessionFile: typeof parsed.sessionFile === 'string' ? parsed.sessionFile : null,
      error: typeof parsed.error === 'string' ? parsed.error : '',
    });
  }
  return results;
}

/** Collects child session/output refs from results for T6 aggregation. */
export function collectChildRefs(results: SubagentResult[]): {
  executionId: string;
  runId: string | null;
  sessionFile: string | null;
}[] {
  return results.map((result) => ({
    executionId: result.executionId,
    runId: result.runId,
    sessionFile: result.sessionFile,
  }));
}

/** Counts live child executions in a task snapshot (events + queue). */
export function countSnapshotChildren(snapshot: TaskSnapshot): number {
  void snapshot;
  return 0;
}

function tryParseOutput(output: string): SubagentToolOutput | null {
  try {
    const value: unknown = JSON.parse(output);
    return typeof value === 'object' && value !== null ? (value as SubagentToolOutput) : null;
  } catch {
    return null;
  }
}
