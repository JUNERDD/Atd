import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { FilePlus, Paperclip } from 'lucide-react';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import { Spinner } from '@atd/ui/components/spinner';
import { MAX_ATTACHMENTS, MAX_FOLDERS } from '@atd/agent-contracts';
import { useFileDrag, type FileDrag } from '../lib/file-drag';
import './file-drop-overlay.css';

/** What releasing the drag does, or the import of a drop under way. */
type DropOutcome =
  | { kind: 'attach'; count: number; total: number }
  | { kind: 'full' }
  | { kind: 'tooMany'; room: number }
  | { kind: 'importing' };

/**
 * Mirrors what happens to a drop: the shell imports the first 10 files, of any format, and the
 * first 10 folders, and the composer refuses a batch larger than the draft's `room`. A drag over
 * the panel always carries something the import takes (`files.drag`); the service may still
 * refuse a file after the drop, which the import's failures report.
 */
function dropOutcome(drag: FileDrag, room: number): DropOutcome | null {
  if (drag.phase === 'none') return null;
  if (drag.phase === 'importing') return { kind: 'importing' };
  if (room <= 0) return { kind: 'full' };
  if (drag.attachable > room) return { kind: 'tooMany', room };
  return { kind: 'attach', count: drag.attachable, total: drag.files };
}

/** The overlay's icon, title and description lines for an outcome. */
function dropCopy(
  outcome: DropOutcome,
  t: TFunction<'panel'>,
): { icon: ReactNode; title: string; lines: string[] } {
  switch (outcome.kind) {
    case 'attach':
      return {
        icon: <FilePlus />,
        title: t('composer.drop.title'),
        // Dragged items stay out only past the import's caps, which the rules name.
        lines:
          outcome.count === outcome.total
            ? [t('composer.drop.attach', { count: outcome.count })]
            : [
                t('composer.drop.attachSome', { count: outcome.count, total: outcome.total }),
                t('composer.drop.rules', { max: MAX_ATTACHMENTS, folders: MAX_FOLDERS }),
              ],
      };
    case 'full':
      return {
        icon: <Paperclip />,
        title: t('composer.drop.full'),
        lines: [t('composer.drop.fullDescription', { max: MAX_ATTACHMENTS })],
      };
    case 'tooMany':
      return {
        icon: <Paperclip />,
        title: t('composer.drop.tooMany'),
        lines: [t('composer.drop.tooManyDescription', { count: outcome.room })],
      };
    case 'importing':
      return { icon: <Spinner />, title: t('composer.drop.importing'), lines: [] };
  }
}

/**
 * The panel body's drop target while files are dragged over the panel: it says whether a drop
 * attaches them as context and how many, or why it would not, and that dropped files are being
 * added until their chips arrive. `room` is how many more files the draft takes. It never takes
 * pointer input; the drag belongs to the shell.
 */
export function FileDropOverlay({ room }: { room: number }) {
  const { t } = useTranslation('panel');
  const outcome = dropOutcome(useFileDrag(), room);
  if (!outcome) return null;
  const { icon, title, lines } = dropCopy(outcome, t);
  const state =
    outcome.kind === 'attach' ? 'accept' : outcome.kind === 'importing' ? 'importing' : 'refuse';
  return (
    <output className="file-drop-overlay surface-glass" data-state={state}>
      <Empty className="file-drop-target border">
        <EmptyHeader>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          {lines.map((line) => (
            <EmptyDescription key={line}>{line}</EmptyDescription>
          ))}
        </EmptyHeader>
      </Empty>
    </output>
  );
}
