import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent';

type AgentMessage = AgentSession['messages'][number];

export type ServiceBranchItem =
  | {
      type: 'message';
      message: AgentMessage;
      /** The message's session entry; absent only for the live partial, which is not persisted. */
      entryId?: string;
      endedAt?: number;
      /** A failed attempt Pi replaced with its retry (`supersededEntries`). */
      superseded?: true;
    }
  | { type: 'custom'; customType: string; data?: unknown }
  | {
      type: 'custom_message';
      customType: string;
      content: unknown;
      display: boolean;
      details?: unknown;
      entryId: string;
      timestamp: number;
    }
  | { type: 'compaction'; id: string; summary: string; tokensBefore: number; timestamp: number };

/**
 * Pi 0.99 session-branch projection. `usage` entries are reported on the
 * settled message instead, and mid-transcript `system` entries are prompt
 * patches rather than conversation content, so both are skipped by design.
 * `context_edit` entries only change what later provider requests see; the
 * transcript keeps showing the raw history they edit, so they are skipped too,
 * except that they mark failed attempts a retry superseded.
 */
export function fromServiceBranch(entries: readonly SessionEntry[]): ServiceBranchItem[] {
  const items: ServiceBranchItem[] = [];
  const superseded = supersededEntries(entries);
  for (const entry of entries) {
    switch (entry.type) {
      case 'message': {
        const endedAt = Date.parse(entry.timestamp);
        items.push({
          type: 'message',
          message: entry.message,
          entryId: entry.id,
          ...(Number.isNaN(endedAt) ? {} : { endedAt }),
          ...(superseded.has(entry.id) ? { superseded: true as const } : {}),
        });
        break;
      }
      case 'custom':
        items.push({ type: 'custom', customType: entry.customType, data: entry.data });
        break;
      case 'custom_message':
        items.push({
          type: 'custom_message',
          customType: entry.customType,
          content: entry.content,
          display: entry.display,
          details: entry.details,
          entryId: entry.id,
          timestamp: Date.parse(entry.timestamp),
        });
        break;
      case 'compaction':
        items.push({
          type: 'compaction',
          id: entry.id,
          summary: entry.summary,
          tokensBefore: entry.tokensBefore,
          timestamp: Date.parse(entry.timestamp) || 0,
        });
        break;
      case 'thinking_level_change':
      case 'model_change':
      case 'branch_summary':
      case 'label':
      case 'session_info':
      case 'usage':
      case 'context_edit':
        break;
      default: {
        const _exhaustive: never = entry;
        return _exhaustive;
      }
    }
  }
  return items;
}

/**
 * Messages Pi dropped to retry. Before retrying a turn that failed with a transient provider error,
 * or compacting and retrying one that overflowed the context, Pi omits the failed attempt from
 * later context with a `context_edit` whose replacement is null
 * (`AgentSession._omitRecoveryAttempt`); the service's own edits always replace content. Once the
 * retry's assistant message or the overflow's compaction follows, the retry supersedes the
 * attempt, so its error is not the run's outcome and must not show. Until then, and when a user
 * message comes first (the recovery failed and the run ended), the attempt keeps showing.
 */
function supersededEntries(entries: readonly SessionEntry[]): Set<string> {
  const omitted = new Set<string>();
  const superseded = new Set<string>();
  for (const entry of entries) {
    if (entry.type === 'context_edit' && entry.replacement === null) omitted.add(entry.targetId);
    const role = entry.type === 'message' ? entry.message.role : undefined;
    if (role === 'user') omitted.clear();
    if (entry.type !== 'compaction' && role !== 'assistant') continue;
    for (const id of omitted) superseded.add(id);
    omitted.clear();
  }
  return superseded;
}
