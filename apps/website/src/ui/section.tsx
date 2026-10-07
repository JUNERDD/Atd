import type { ReactNode } from 'react';
import './section.css';

interface SectionProps {
  /** The anchor id; the title gets `${id}-title`. */
  id: string;
  title: string;
  lede?: ReactNode;
  children?: ReactNode;
}

/**
 * One plate of the faceplate: a full-bleed band of the dot grid, joined to the plate above it by a
 * seam with registration crosses where the content column's edges meet it. The heading and lede
 * share the plate's center line; the heading lights in dots, as the hero lights its word.
 *
 * As the plate arrives the seam draws across and the crosses plot in; then the heading flickers
 * on like an LED, and the lede follows.
 */
export function Section({ id, title, lede, children }: SectionProps) {
  const titleId = `${id}-title`;
  return (
    <section id={id} className="section plate" aria-labelledby={titleId}>
      <span className="section__seam" aria-hidden="true" data-reveal="draw" />
      <div className="section__frame container">
        <span className="section__mark" data-corner="start" aria-hidden="true" data-reveal="plot" />
        <span
          className="section__mark"
          data-corner="end"
          aria-hidden="true"
          data-reveal="plot"
          data-reveal-delay="120"
        />
        <header className="section__header" data-reveal-group="">
          <h2
            id={titleId}
            className="section__title dot-text"
            data-reveal="light"
            data-reveal-delay="140"
          >
            {title}
          </h2>
          {lede ? (
            <p className="section__lede" data-reveal="fade" data-reveal-delay="360">
              {lede}
            </p>
          ) : null}
        </header>
        {children}
      </div>
    </section>
  );
}
