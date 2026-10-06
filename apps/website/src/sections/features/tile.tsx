import type { ReactNode } from 'react';
import { DotGlyph } from '../../ui/dot-glyph';

interface FeatureTileProps {
  /** The instrument code printed in the corner, such as `B·04`. */
  code: string;
  glyph: readonly string[];
  title: string;
  body: string;
  /** Columns the tile spans in the regular (2-column) and wide (6-column) bands. */
  regular: 1 | 2;
  wide: 2 | 4;
  /** A demo or control under the text. */
  children?: ReactNode;
}

/** One opaque bento tile: its pictogram and code, a title, a sentence or two, and an optional demo. */
export function FeatureTile({
  code,
  glyph,
  title,
  body,
  regular,
  wide,
  children,
}: FeatureTileProps) {
  return (
    <li className="feat__tile reveal" data-regular={regular} data-wide={wide}>
      <div className="feat__top">
        <span className="feat__glyph">
          <DotGlyph rows={glyph} />
        </span>
        <span className="feat__code mono-label">{code}</span>
      </div>
      <h3 className="feat__title">{title}</h3>
      <p className="feat__body">{body}</p>
      {children}
    </li>
  );
}
