import { Fragment } from 'react';
import type { HeroReading } from './copy';

/** A readout value. Keys render as small keycaps; a symbol legend gets its spoken name. */
export function ReadingValue({ reading, delay }: { reading: HeroReading; delay: number }) {
  if (!('keys' in reading)) {
    return (
      <dd className="hero__reading-value" data-reveal={reading.effect} data-reveal-delay={delay}>
        {reading.value}
      </dd>
    );
  }
  return (
    <dd className="hero__reading-value">
      {reading.keys.map((key) => (
        <kbd key={key.legend} className="hero__key">
          {key.name === key.legend ? (
            key.legend
          ) : (
            <>
              <span aria-hidden="true">{key.legend}</span>
              <span className="sr-only">{key.name}</span>
            </>
          )}
        </kbd>
      ))}
    </dd>
  );
}

interface LegendProps {
  legend: { label: string; parts: readonly string[]; suffix: string };
  /** The word on the display: 0 is the name, then one per part. */
  word: number;
}

/**
 * The name's legend, first in the strip: the name over the words it stands for. Whatever the display
 * shows lights up here — the name, or the part it is spelling out — so the two read together.
 */
export function HeroLegend({ legend, word }: LegendProps) {
  return (
    <div className="hero__reading hero__legend" data-reveal="rise" data-reveal-delay="160">
      <dt className="mono-label hero__legend-name" data-on={word === 0 ? '' : undefined}>
        {legend.label}
      </dt>
      <dd className="hero__reading-value">
        {legend.parts.map((part, index) => (
          <Fragment key={part}>
            {index > 0 ? ' · ' : null}
            <span className="hero__legend-part" data-on={word === index + 1 ? '' : undefined}>
              {part}
            </span>
          </Fragment>
        ))}
        {legend.suffix}
      </dd>
    </div>
  );
}
