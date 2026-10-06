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

/**
 * One opaque bento tile: its pictogram and code, a title, a sentence or two, and an optional demo.
 *
 * Each tile is its own reveal group, so tiles further down enter as they arrive and tiles arriving
 * together cascade left to right. The tile lifts in, its pictogram lights up dot by dot in a diagonal
 * wave (features.css), its code decodes, and the title and body rise after it. A demo is a group of
 * its own, so it comes alive when it is on screen rather than with the tile's top edge.
 */
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
    <li
      className="feat__tile"
      data-regular={regular}
      data-wide={wide}
      data-reveal="lift"
      data-reveal-group=""
      data-spotlight=""
    >
      <div className="feat__top">
        <span className="feat__glyph">
          <DotGlyph rows={glyph} />
        </span>
        <span className="feat__code mono-label" data-reveal="decode" data-reveal-delay="160">
          {code}
        </span>
      </div>
      <h3 className="feat__title" data-reveal="rise" data-reveal-delay="220">
        {title}
      </h3>
      <p className="feat__body" data-reveal="rise" data-reveal-delay="290">
        {body}
      </p>
      {children}
    </li>
  );
}
