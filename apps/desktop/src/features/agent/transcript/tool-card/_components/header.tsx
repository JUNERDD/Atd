import type { ReactNode } from 'react';
import { cn } from '@atd/ui/lib/utils';
import { CopyButton } from '../../copy-button';

/**
 * The card's title bar. `icon` is a 12px Lucide glyph, `label` names the content (a file, a
 * command kind, a tally), `meta` sits at the trailing edge before the copy action. Copy stays
 * hidden until the card is hovered or focused, like every other desc box.
 */
export function Header({
  icon,
  label,
  meta,
  copyText,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  copyText?: string | undefined;
  className?: string;
}) {
  return (
    <div data-slot="tool-card-header" className={cn('tool-card-header', className)}>
      {icon && <span className="tool-card-icon">{icon}</span>}
      <span className="tool-card-label">{label}</span>
      {meta && <span className="tool-card-meta">{meta}</span>}
      {copyText && <CopyButton text={copyText} className="tool-card-copy" />}
    </div>
  );
}
