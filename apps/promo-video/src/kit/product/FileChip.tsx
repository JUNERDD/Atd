import type { ReactNode } from 'react';
import { FileText, type LucideIcon } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { springs } from '../../motion/spring.ts';
import { arrival, present } from './motion.ts';
import { strings } from './strings.ts';
import './tokens.css';
import './file-chip.css';

export type FileChipVariant = 'attachment' | 'result' | 'image';

export interface FileChipProps {
  lang: Lang;
  /**
   * - `attachment`: a file sent with a message, above its bubble (`attachment-file.tsx`): a 52 pt
   *   card on the bubble's fill with the kind tile, the name and its size;
   * - `result`: a file the task saved (`task-files.tsx`): an outline item with "12 KB · Available";
   * - `image`: a sent screenshot or picture, a thumbnail with a 10 pt corner holding `thumbnail`.
   */
  variant: FileChipVariant;
  /** The file's name, untranslated (`summary.md`). */
  name?: string | undefined;
  /** Its size as the app writes it (`12 KB`). */
  size?: string | undefined;
  /** The kind glyph; `FileText` by default (a sheet or CSV reads as `FileSpreadsheet`). */
  icon?: LucideIcon | undefined;
  /** For `image`: what the thumbnail shows (a capture drawn in DOM), filling its box. */
  thumbnail?: ReactNode;
  /** For `image`: the thumbnail's box in points. Default 160 × 100. */
  width?: number | undefined;
  height?: number | undefined;
  /** Seconds since it appeared: it pops in. */
  age?: number | undefined;
}

/** A file in the transcript: sent with a message, saved by the task, or a sent image. */
export function FileChip({
  lang,
  variant,
  name = '',
  size,
  icon: Icon = FileText,
  thumbnail,
  width = 160,
  height = 100,
  age,
}: FileChipProps) {
  if (!present(age)) return null;
  const t = strings[lang].files;
  const pop = { '--in': arrival(age, springs.pop) };
  if (variant === 'image')
    return (
      <div className="pk-file-pop" style={pop}>
        <div className="pk-file-image" style={{ '--w': `${width}px`, '--h': `${height}px` }}>
          {thumbnail}
        </div>
      </div>
    );
  if (variant === 'attachment')
    return (
      <div className="pk-file-pop" style={pop}>
        <div className="pk-file">
          <span className="pk-file__tile">
            <Icon className="pk-icon" />
          </span>
          <span className="pk-file__text">
            <span className="pk-file__name">{name}</span>
            {size && <span className="pk-file__meta">{size}</span>}
          </span>
        </div>
      </div>
    );
  return (
    <div className="pk-file-pop" style={pop}>
      <div className="pk-file-result">
        <Icon className="pk-icon pk-file-result__icon" />
        <span className="pk-file__text">
          <span className="pk-file__name">{name}</span>
          <span className="pk-file__meta">{size ? `${size} · ${t.available}` : t.available}</span>
        </span>
      </div>
    </div>
  );
}
