import { useTranslation } from 'react-i18next';
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
 * Read-only capture above a run's prompt bubble, once per run: queued follow-ups carry none. The
 * bubble already carries the resolved instruction (which embeds the captured text for the built-in
 * templates), so embedded text is not repeated here. Text the instruction omits still surfaces as
 * a static preview (Input-page pattern); attached files surface as rows (User message pattern),
 * except the ones the bubble already shows as file chips.
 */
export function UserContext({
  snapshot,
  chipFileIds,
}: {
  snapshot: RunSnapshot;
  /** Files drawn as chips in the bubble below. */
  chipFileIds: ReadonlySet<string>;
}) {
  const { t } = useTranslation('panel');
  const { input } = snapshot;
  const text =
    input.source === 'selection'
      ? input.selection
      : input.source === 'clipboard'
        ? input.clipboard
        : '';
  const showText = Boolean(text) && !snapshot.instructions.includes(text);
  const files = input.files.filter((file) => !chipFileIds.has(file.id));
  if (!showText && files.length === 0) return null;
  return (
    <ContextBubble.Root>
      {showText && (
        <ContextBubble.Meta className="text-sm font-medium text-foreground">
          {input.source === 'selection' ? t('input.selectedText') : t('input.clipboardText')}
        </ContextBubble.Meta>
      )}
      {showText && <ContextBubble.Preview>{text}</ContextBubble.Preview>}
      {files.length > 0 && (
        <ContextBubble.Files>
          {files.map((file) => (
            <ContextBubble.FileItem key={file.id} file={file} detail={fileDetail(file)} />
          ))}
        </ContextBubble.Files>
      )}
    </ContextBubble.Root>
  );
}
