import { ContextBubble } from '../../components/context-bubble';
import type { FileRef, RunSnapshot } from '../../../electron/agent/task-schema';
import { fileSize } from '../../lib/task-store';

function fileDetail(file: FileRef): string {
  const size = fileSize(file.size);
  const dot = file.name.lastIndexOf('.');
  if (dot <= 0 || dot === file.name.length - 1) return size;
  return `${file.name.slice(dot + 1).toUpperCase()} · ${size}`;
}

/**
 * Files attached to a run, as rows above its prompt bubble (User message pattern), once per run:
 * queued follow-ups carry none. Files the bubble already shows as chips are skipped. Captured
 * selection or clipboard text is not previewed here: the bubble carries the resolved instruction,
 * which is where a command places that text.
 */
export function UserContext({
  snapshot,
  chipFileIds,
}: {
  snapshot: RunSnapshot;
  /** Files drawn as chips in the bubble below. */
  chipFileIds: ReadonlySet<string>;
}) {
  const files = snapshot.input.files.filter((file) => !chipFileIds.has(file.id));
  if (files.length === 0) return null;
  return (
    <ContextBubble.Root>
      <ContextBubble.Files>
        {files.map((file) => (
          <ContextBubble.FileItem key={file.id} file={file} detail={fileDetail(file)} />
        ))}
      </ContextBubble.Files>
    </ContextBubble.Root>
  );
}
