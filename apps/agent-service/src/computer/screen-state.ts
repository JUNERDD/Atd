import type { ScreenCursor, ScreenShareReply, VisualSource } from '@atd/agent-contracts';

/** Metadata only: current screen pixels stay with the native stream, never in task history. */
export interface SharedScreens {
  taskId: string;
  sources: ScreenCursor[];
}

export class ScreenShareBoard {
  private readonly runs = new Map<string, SharedScreens>();
  private readonly notices = new Map<string, { taskId: string; reply: ScreenShareReply }>();

  get(taskId: string, runId: string): SharedScreens | undefined {
    const entry = this.runs.get(runId);
    return entry?.taskId === taskId ? entry : undefined;
  }

  remember(taskId: string, runId: string, reply: ScreenShareReply): void {
    const existing = this.runs.get(runId);
    if (existing && existing.taskId !== taskId) return;
    if (reply.state === 'ended') {
      // Cancelling an additional picker selection leaves the already shared sources running.
      if (reply.reason === 'cancelled' && existing) return;
      this.runs.delete(runId);
      this.notices.set(runId, { taskId, reply });
      return;
    }
    this.notices.delete(runId);
    this.runs.set(runId, {
      taskId,
      sources: reply.sources.map(({ sourceId, sequence }) => ({ sourceId, sequence })),
    });
  }

  /** The host's complete membership is authoritative even when its image budget omitted a share. */
  read(
    taskId: string,
    runId: string,
    sharedSources: readonly ScreenCursor[],
    sources: readonly VisualSource[],
  ): void {
    const current = this.runs.get(runId);
    if (current && current.taskId !== taskId) return;
    if (!sharedSources.length) {
      this.runs.delete(runId);
      return;
    }
    this.notices.delete(runId);
    this.runs.set(runId, {
      taskId,
      sources: sharedSources.map((cursor) => {
        // A stream may encode another revision while other sources are being read. Consume only
        // the image actually returned, so watchScreen can still observe that newer revision.
        const source = sources.find(
          (entry) => entry.sourceId === cursor.sourceId && entry.state === 'frame',
        );
        return source ? { sourceId: source.sourceId, sequence: source.sequence } : { ...cursor };
      }),
    });
  }

  forget(runId: string): void {
    this.runs.delete(runId);
    this.notices.delete(runId);
  }

  /** Keep one terminal notice until the next inference; no pixels or read admission survive. */
  disconnected(): void {
    for (const [runId, { taskId }] of this.runs)
      this.notices.set(runId, {
        taskId,
        reply: { kind: 'screenShare', state: 'ended', reason: 'disconnected' },
      });
    this.runs.clear();
  }

  hasNotice(taskId: string, runId: string): boolean {
    return this.notices.get(runId)?.taskId === taskId;
  }

  takeNotice(taskId: string, runId: string): ScreenShareReply | undefined {
    const notice = this.notices.get(runId);
    if (notice?.taskId !== taskId) return undefined;
    this.notices.delete(runId);
    return notice.reply;
  }
}

/** The persisted tool result omits image bytes; the context hook supplies a transient image. */
export function visualSourceFacts(source: VisualSource) {
  if (source.state !== 'frame') return source;
  const { base64, ...facts } = source;
  void base64;
  return facts;
}

export function screenShareFacts(reply: ScreenShareReply) {
  return reply.state === 'sharing'
    ? { ...reply, sources: reply.sources.map(visualSourceFacts) }
    : reply;
}
