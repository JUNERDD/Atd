import type { Block } from './transcript-schema';
import { diffBlocks } from './transcript';
import { publish } from './worker-channel';

const FLUSH_MS = 40;

export function createTranscriptPublisher(options: {
  taskId: () => string;
  /** Pi JSONL path once written; empty before the first persisted entry. */
  sessionFile: () => string;
  project: () => Block[];
}) {
  let revision = 0;
  let blocks: Block[] = [];
  let published = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const next = options.project();
    const taskId = options.taskId();
    if (!published) {
      published = true;
      revision = 1;
      blocks = next;
      publish({
        type: 'transcript',
        patch: { taskId, revision, snapshot: true, blocks: next, removed: [] },
        sessionFile: options.sessionFile(),
      });
      return;
    }
    const { blocks: changed, removed } = diffBlocks(blocks, next);
    if (!changed.length && !removed.length) return;
    revision += 1;
    blocks = next;
    publish({
      type: 'transcript',
      patch: { taskId, revision, snapshot: false, blocks: changed, removed },
      sessionFile: options.sessionFile(),
    });
  };

  return {
    flush,
    schedule() {
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    },
    release() {
      clearTimeout(timer);
      timer = undefined;
    },
    document: () => ({ revision, blocks }),
  };
}
