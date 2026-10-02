import { isChildExecutionId, parseChildExecutionId, type ServiceEvent } from '@atd/agent-contracts';

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
