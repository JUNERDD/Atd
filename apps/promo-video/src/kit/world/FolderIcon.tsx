import type { Bounce } from './bounce.ts';
import './icons.css';

interface FolderIconProps {
  /** The label under the icon. */
  name: string;
  /** The icon's size, in points (64 on the desktop). */
  size?: number;
  /** From `bounceAt(t, hits)`: the hop when files land in it. */
  bounce?: Bounce;
  /** A count badge at the top-right (hidden at 0 or undefined). */
  badge?: number;
  /** The badge's scale, 0–1, to pop it in with a spring. */
  badgeScale?: number;
  selected?: boolean;
}

/**
 * A macOS folder icon with its label, in points, drawn in SVG (in the film's light cyan, close to
 * the system's folder blue): back with tab, front with a soft top light. It hops on `bounce` and
 * shows an optional count badge. Its box is `size` wide; the label hangs below.
 */
export function FolderIcon({
  name,
  size = 64,
  bounce,
  badge,
  badgeScale = 1,
  selected = false,
}: FolderIconProps) {
  return (
    <div
      className="desktop-icon"
      data-selected={selected ? '' : undefined}
      style={{
        '--size': size,
        '--lift': bounce?.lift ?? 0,
        '--squash': bounce?.squash ?? 0,
      }}
    >
      <div className="desktop-icon__art">
        <svg className="folder-icon" viewBox="0 0 80 64" aria-hidden="true">
          <path
            className="folder-icon__back"
            d="M4 12a5 5 0 0 1 5-5h18.5a5 5 0 0 1 3.6 1.5l3.8 4h36.1a5 5 0 0 1 5 5V56a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"
          />
          <path className="folder-icon__paper" d="M9 15h62v20H9z" />
          <rect className="folder-icon__front" x="4" y="19.5" width="72" height="41.5" rx="5" />
          <path className="folder-icon__rim" d="M9 20.2h62" />
        </svg>
        {badge ? (
          <span className="desktop-icon__badge" style={{ '--badge': badgeScale }}>
            {badge}
          </span>
        ) : null}
      </div>
      <span className="desktop-icon__label">{name}</span>
    </div>
  );
}
