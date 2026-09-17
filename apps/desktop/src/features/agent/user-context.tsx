import { useTranslation } from 'react-i18next';
import { ContextBubble } from '../../components/context-bubble';
import type { RunSnapshot } from '../../../electron/agent/task-schema';
import { fileDetail } from './pending-message-text';

/**
 * Read-only capture above its owning user bubble. The bubble below already
 * below already carries the resolved instruction (which embeds the captured
 * text for the built-in templates), so embedded text is not repeated here.
 * Text the instruction omits still surfaces as a static preview (Input-page
 * pattern); attached files always surface as rows (User message pattern).
 */
export function UserContext({ snapshot }: { snapshot: RunSnapshot | undefined }) {
  const { t } = useTranslation('panel');
  const input = snapshot?.input;
  if (!input) return null;
  const text =
    input.source === 'selection'
      ? input.selection
      : input.source === 'clipboard'
        ? input.clipboard
        : '';
  const showText = Boolean(text) && !(snapshot?.instructions ?? '').includes(text);
  const files = input.files ?? [];
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
