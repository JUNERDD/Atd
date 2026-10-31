import { File, type LucideProps } from 'lucide-react';
import { FILE_KIND_ICONS, fileKind } from '../lib/file-kinds';

/** The glyph naming an attached file's kind; a plain page for a file of no known kind. */
export function FileKindIcon({
  name,
  mime,
  ...props
}: { name: string; mime: string } & LucideProps) {
  const kind = fileKind(name, mime);
  const Icon = kind ? FILE_KIND_ICONS[kind] : File;
  return <Icon {...props} />;
}
