import type { ReactNode } from 'react';
import './section.css';

interface SectionProps {
  /** The anchor id; the title gets `${id}-title`. */
  id: string;
  /** The grid index printed before the kicker, such as `A·02`. */
  index: string;
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  /** `dark` sits on the page's dot grid, `void` on pure black, `paper` is the one light section. */
  tone?: 'dark' | 'void' | 'paper';
  children?: ReactNode;
}

/**
 * The standard section frame: a full-bleed band with one message — an instrument label, a heading
 * and an optional lede — and registration marks at the frame's corners.
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
        <span className="section__mark" data-corner="start" aria-hidden="true" />
        <span className="section__mark" data-corner="end" aria-hidden="true" />
        <header className="section__header reveal">
          <p className="section__meta mono-label">
            <span className="section__index">{index}</span>
            <span>{kicker}</span>
          </p>
          <h2 id={titleId} className="section__title">
            {title}
          </h2>
          {lede ? <p className="section__lede">{lede}</p> : null}
        </header>
        {children}
      </div>
    </section>
  );
}
