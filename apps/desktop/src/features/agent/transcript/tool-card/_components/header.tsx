import type { ReactNode } from 'react';
import { cn } from '@atd/ui/lib/utils';
import { CopyButton } from '../../copy-button';

/** The text a plain label or meta shows, which its tooltip repeats once the header cuts it short. */
function plainText(node: ReactNode): string | undefined {
  return typeof node === 'string' || typeof node === 'number' ? String(node) : undefined;
}

/**
 * The card's title bar. `icon` is a 12px Lucide glyph, `label` names the content (a file, a
 * command kind, a tally), `meta` sits at the trailing edge before the copy action. Label and meta
 * share a narrow header fairly (`tool-card.css`), so either may truncate: plain text keeps its
 * full value as a tooltip, and a label or meta given as an element carries its own `title`. Copy
 * stays hidden until the card is hovered or focused, like every other desc box.
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
  const metaText = plainText(meta);
  return (
    <div data-slot="tool-card-header" className={cn('tool-card-header', className)}>
      {icon && <span className="tool-card-icon">{icon}</span>}
      <span className="tool-card-label" title={plainText(label)}>
        {label}
      </span>
      {meta && (
        <span className="tool-card-meta" title={metaText}>
          {/* Plain text ellipsizes inside the meta, which stays a row for element tallies. */}
          {metaText === undefined ? meta : <span className="truncate">{metaText}</span>}
        </span>
      )}
      {copyText && <CopyButton text={copyText} className="tool-card-copy" />}
    </div>
  );
}
