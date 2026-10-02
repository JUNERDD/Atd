import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from 'lucide-react';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@atd/ui/components/item';
import type { FileRef } from '../../client/agent/task-schema';
import { fileSize } from '../../lib/file-size';

const CODE = new Set(
  'html htm css scss js mjs cjs jsx ts tsx json xml yml yaml toml sh zsh py rb go rs swift kt java c h cpp cs php sql'.split(
    ' ',
  ),
);
const TEXT = new Set('txt md markdown rtf pdf doc docx pages odt log'.split(' '));
const SHEET = new Set('csv tsv xls xlsx numbers ods'.split(' '));
const ARCHIVE = new Set('zip tar gz tgz bz2 xz 7z rar dmg'.split(' '));

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? null : name.slice(dot + 1).toLowerCase();
}

type FileKind = 'audio' | 'video' | 'code' | 'text' | 'sheet' | 'archive' | 'file';

/** The glyph that names the file's kind, as Finder's document icons do; a plain page otherwise. */
const ICONS: Record<FileKind, LucideIcon> = {
  audio: FileAudio,
  video: FileVideo,
  code: FileCode,
  text: FileText,
  sheet: FileSpreadsheet,
  archive: FileArchive,
  file: File,
};

function kindOf(file: FileRef, extension: string | null): FileKind {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  if (!extension) return 'file';
  if (CODE.has(extension)) return 'code';
  if (TEXT.has(extension)) return 'text';
  if (SHEET.has(extension)) return 'sheet';
  if (ARCHIVE.has(extension)) return 'archive';
  return 'file';
}

/**
 * Splits a name for middle truncation, as Finder truncates file names: the head shrinks to an
 * ellipsis while the tail keeps the extension and the few characters before it, which usually tell
 * versions of one document apart. Short names stay whole.
 */
function nameParts(name: string, extension: string | null): [head: string, tail: string] {
  const keep = (extension ? extension.length + 1 : 0) + 6;
  if (name.length <= keep + 4) return [name, ''];
  return [name.slice(0, -keep), name.slice(-keep)];
}

/**
 * One attached non-image file above a sent prompt: an opaque card in the message's content layer
 * with the bubble's fill (`.user-context-file` in `agent.css`), a tile whose glyph names the file's
 * kind, the name truncated in the middle and "EXT · size" below it. The button's label names its
 * action; the title tooltip carries the full name.
 */
export function AttachmentFile({
  file,
  label,
  onReveal,
}: {
  file: FileRef;
  /** The accessible name of the click action ("Show … in Finder"). */
  label: string;
  onReveal: () => void;
}) {
  const extension = extensionOf(file.name);
  const Icon = ICONS[kindOf(file, extension)];
  const [head, tail] = nameParts(file.name, extension);
  const size = fileSize(file.size);
  return (
    <Item
      asChild
      size="sm"
      variant="muted"
      className="user-context-file gap-2.5 border-0 py-2 pr-3.5 pl-2"
    >
      <button type="button" aria-label={label} onClick={onReveal}>
        <ItemMedia className="user-context-file-icon">
          <Icon className="size-[18px]" />
        </ItemMedia>
        <ItemContent className="gap-0">
          <ItemTitle className="flex leading-5" title={file.name}>
            <span className="min-w-0 truncate">{head}</span>
            {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
          </ItemTitle>
          <ItemDescription className="text-xs leading-4">
            {extension ? `${extension.toUpperCase()} · ${size}` : size}
          </ItemDescription>
        </ItemContent>
      </button>
    </Item>
  );
}
