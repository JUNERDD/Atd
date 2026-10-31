import {
  FileArchive,
  FileBraces,
  FileChartPie,
  FileCode,
  FileHeadphone,
  FileImage,
  FilePlay,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from 'lucide-react';
import { fileFormat, type FileKind } from '@atd/agent-contracts';

/**
 * One glyph per format family (`FileKind`), as Finder's document icons name a file's kind.
 * Documents share plain text's page; Lucide has no slide-deck glyph, so presentations take the
 * chart one.
 */
export const FILE_KIND_ICONS: Record<FileKind, LucideIcon> = {
  text: FileText,
  code: FileCode,
  data: FileBraces,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: FileChartPie,
  image: FileImage,
  audio: FileHeadphone,
  video: FilePlay,
  archive: FileArchive,
};

/** A file's family by the known format of its name, else by its media type's top level. */
export function fileKind(name: string, mime: string): FileKind | null {
  const known = fileFormat(name)?.kind;
  if (known) return known;
  const family = mime.slice(0, mime.indexOf('/'));
  return family === 'image' || family === 'audio' || family === 'video' ? family : null;
}
