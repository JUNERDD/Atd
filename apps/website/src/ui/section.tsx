import type { ReactNode } from 'react';
import './section.css';

interface SectionProps {
  /** The anchor id; the title gets `${id}-title`. */
  id: string;
  /**
   * The heading. Leave it out when the children place the heading themselves with `SectionHeader`,
   * as the interfaces showcase does to pin it with its stage.
   */
  title?: string;
  lede?: ReactNode;
  children?: ReactNode;
}

/**
 * One plate of the faceplate: a full-bleed band of the dot grid, joined to the plate above it by a
 * seam with registration crosses where the content column's edges meet it. The heading and lede
 * share the plate's center line; the heading keeps the faceplate's dot typography.
 *
 * As the plate arrives the seam draws across and the crosses plot in; the heading fades in with
 * a small rise, and the lede follows.
 */
export function Section({ id, title, lede, children }: SectionProps) {
  return (
    <section id={id} className="section plate" aria-labelledby={`${id}-title`}>
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
        {title === undefined ? null : <SectionHeader id={id} title={title} lede={lede} />}
        {children}
      </div>
    </section>
  );
}

interface SectionHeaderProps {
  /** The section's anchor id: the heading takes `${id}-title`, which labels the section. */
  id: string;
  title: string;
  lede?: ReactNode;
}

/** A section's heading and lede on the plate's center line, as `Section` places them. */
export function SectionHeader({ id, title, lede }: SectionHeaderProps) {
  return (
    <header className="section__header" data-reveal-group="">
      <h2
        id={`${id}-title`}
        className="section__title dot-text"
        data-reveal="rise"
        data-reveal-delay="80"
      >
        {title}
      </h2>
      {lede ? (
        <p className="section__lede" data-reveal="fade" data-reveal-delay="240">
          {lede}
        </p>
      ) : null}
    </header>
  );
}
