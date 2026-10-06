import type { ReactNode } from 'react';
import { SplitText } from './split-text';
import './section.css';

interface SectionProps {
  /** The anchor id; the title gets `${id}-title`. */
  id: string;
  /** The grid index printed before the kicker, such as `A·02`. */
  index: string;
  kicker: string;
  /**
   * A plain string rises in word by word. Other content renders as given: compose it with
   * `SplitText` (delay 160) to keep the same entrance.
   */
  title: ReactNode;
  lede?: ReactNode;
  /** `dark` sits on the page's dot grid, `void` on pure black, `paper` is the one light section. */
  tone?: 'dark' | 'void' | 'paper';
  children?: ReactNode;
}

/**
 * The standard section frame: a full-bleed band with one message — an instrument label, a heading
 * and an optional lede — under a hairline drawn between registration marks at the frame's corners.
 * As the band arrives, the marks plot in and the hairline draws between them; then the index
 * decodes, the kicker fades up, the heading rises word by word and the lede follows.
 */
export function Section({ id, index, kicker, title, lede, tone = 'dark', children }: SectionProps) {
  const titleId = `${id}-title`;
  return (
    <section
      id={id}
      className="section"
      data-tone={tone}
      data-theme={tone === 'paper' ? 'light' : undefined}
      aria-labelledby={titleId}
    >
      <div className="section__frame container">
        <span className="section__mark" data-corner="start" aria-hidden="true" data-reveal="plot" />
        <span
          className="section__mark"
          data-corner="end"
          aria-hidden="true"
          data-reveal="plot"
          data-reveal-delay="120"
        />
        <span
          className="section__rule"
          aria-hidden="true"
          data-reveal="draw"
          data-reveal-delay="60"
        />
        <header className="section__header" data-reveal-group="">
          <p className="section__meta mono-label">
            <span className="section__index" data-reveal="decode">
              {index}
            </span>
            <span data-reveal="fade" data-reveal-delay="120">
              {kicker}
            </span>
          </p>
          <h2 id={titleId} className="section__title">
            {typeof title === 'string' ? <SplitText text={title} delay={160} /> : title}
          </h2>
          {lede ? (
            <p className="section__lede" data-reveal="rise" data-reveal-delay="420">
              {lede}
            </p>
          ) : null}
        </header>
        {children}
      </div>
    </section>
  );
}
