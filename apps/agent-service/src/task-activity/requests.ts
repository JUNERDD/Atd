import {
  TASK_ACTIVITY_DETAIL_CHARS,
  TASK_ACTIVITY_MAX_OPTIONS,
  TASK_ACTIVITY_MAX_REQUESTS,
  type AgentTask,
  type GrantScope,
  type PermissionRequest,
  type TaskActivityGrant,
  type TaskActivityRequest,
  type TaskRun,
} from '@atd/agent-contracts';
import { clip } from '../automations/prompt.js';

/**
 * The pending requests that belong to a root task's run, as the activity card decides them: the
 * root's own requests of this run and those of its subagents (a subagent task carries its root's
 * id, and a child cannot delegate, so the link is one level). Oldest first, at most
 * `TASK_ACTIVITY_MAX_REQUESTS`. `viewCalls` are the ids of the `show_ui` calls the run's
 * transcript shows still running: an input request raised by one of them waits on that view.
 */
export function activityRequests(
  pending: readonly PermissionRequest[],
  task: AgentTask,
  run: TaskRun,
  tasks: ReadonlyMap<string, AgentTask>,
  viewCalls: ReadonlySet<string>,
): TaskActivityRequest[] {
  const owned = pending.filter((request) =>
    request.taskId === task.id
      ? request.runId === run.id
      : tasks.get(request.taskId)?.rootTaskId === task.id,
  );
  // ISO timestamps order lexicographically; the sort is stable, so equal stamps keep ledger order.
  owned.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return owned.slice(0, TASK_ACTIVITY_MAX_REQUESTS).map((request) => {
    const asker = request.taskId === task.id ? undefined : tasks.get(request.taskId);
    return activityRequest(request, asker, viewCalls);
  });
}

function activityRequest(
  request: PermissionRequest,
  subagent: AgentTask | undefined,
  viewCalls: ReadonlySet<string>,
): TaskActivityRequest {
  const base = {
    requestId: request.id,
    revision: request.revision,
    createdAt: request.createdAt,
    ...(subagent ? { subagent: clip(subagent.title, 1024) } : {}),
  };
  if (request.kind === 'input')
    return {
      kind: 'input',
      ...base,
      title: clip(request.title, 4000),
      options: request.options
        .map((option) => clip(option, 500))
        .filter((option) => option !== '')
        .slice(0, TASK_ACTIVITY_MAX_OPTIONS),
      ...(viewCalls.has(request.toolCallId) ? { viewCallId: request.toolCallId } : {}),
    };
  const detailClipped = request.detail.length > TASK_ACTIVITY_DETAIL_CHARS;
  return {
    kind: 'confirmation',
    ...base,
    scope: grant(request.scope),
    title: clip(request.title, 500),
    detail: detailClipped ? request.detail.slice(0, TASK_ACTIVITY_DETAIL_CHARS) : request.detail,
    detailClipped,
    ...(request.allowlistEntry ? { allowlistEntry: request.allowlistEntry } : {}),
    ...(request.review
      ? {
          review: {
            outcome: request.review.outcome,
            reason: request.review.outcome === 'flagged' ? request.review.reason : '',
          },
        }
      : {}),
  };
}

/** What an approval would allow, without the binding ids and revisions only the service needs. */
function grant(scope: GrantScope): TaskActivityGrant {
  if ('location' in scope) return { kind: 'file', tool: scope.tool, location: scope.location };
  if (scope.tool === 'computerAccess') {
    const { target } = scope;
    const browser = target.kind === 'browser';
    return {
      kind: 'computerAccess',
      targetKind: browser ? 'browser' : 'application',
      targetLabel: clip(target.label, 256),
      origins: browser ? target.allowedOrigins.slice(0, 32) : [],
      persistence: scope.persistence,
    };
  }
  return { kind: 'tool', tool: scope.tool };
}
