import './icons.css';

interface PdfIconProps {
  /** The file name under the icon. */
  name: string;
  /** The icon's size, in points (64 on the desktop and in Finder). */
  size?: number;
  selected?: boolean;
  /** Drawn faded, as the original left behind while a copy is dragged. */
  ghost?: boolean;
  /** Hides the label (for the copy that follows the cursor). */
  bare?: boolean;
}

/**
 * A PDF document icon with its file name, in points, drawn in SVG: a page with a folded corner, a
 * preview of text and a figure, and a small PDF tag in the film's coral.
 */
export function PdfIcon({
  name,
  size = 64,
  selected = false,
  ghost = false,
  bare = false,
}: PdfIconProps) {
  return (
    <div
      className="desktop-icon"
      data-selected={selected ? '' : undefined}
      data-ghost={ghost ? '' : undefined}
      style={{ '--size': size, '--lift': 0, '--squash': 0 }}
    >
      <div className="desktop-icon__art">
        <svg className="pdf-icon" viewBox="0 0 64 64" aria-hidden="true">
          <path
            className="pdf-icon__page"
            d="M14 4h26l14 14v40a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"
          />
          <path className="pdf-icon__fold" d="M40 4v11a3 3 0 0 0 3 3h11Z" />
          <path className="pdf-icon__lines" d="M17 14h17M17 19h14M17 26h30M17 30h30M17 34h22" />
          <rect className="pdf-icon__figure" x="17" y="38" width="30" height="10" rx="1.5" />
          <rect className="pdf-icon__tag" x="17" y="51" width="17" height="7" rx="2" />
          <text className="pdf-icon__tag-text" x="25.5" y="56.5">
            PDF
          </text>
        </svg>
      </div>
      {bare ? null : <span className="desktop-icon__label">{name}</span>}
    </div>
  );
}
