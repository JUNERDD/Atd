import { useId, useState } from 'react';
import type { TierId } from './copy';
import './tiers.css';

const TIERS: readonly TierId[] = ['manual', 'auto', 'always'];

interface TierPickerProps {
  legend: string;
  options: Record<TierId, { label: string; description: string }>;
  allowlistLabel: string;
  allowlist: string;
}

/**
 * The three approval tiers as a native radio group (arrow keys move between them), with the chosen
 * tier's description underneath. All three descriptions share one grid cell, so switching never
 * changes the tile's height; each radio is described by its own description for assistive tech.
 *
 * It is a reveal group of its own: when it arrives the legend decodes, the track rises and its thumb
 * slides in from the far end onto the chosen tier (tiers.css), then the description and the
 * allowlist follow. The entrance only moves the thumb; the selection is always the visitor's.
 */
export function TierPicker({ legend, options, allowlistLabel, allowlist }: TierPickerProps) {
  const [tier, setTier] = useState<TierId>('manual');
  const id = useId();

  return (
    <div className="feat__tiers" data-reveal-group="" data-reveal-delay="300">
      <fieldset className="feat__tier-set">
        <legend className="feat__tier-legend mono-label" data-reveal="decode">
          {legend}
        </legend>
        <div
          className="feat__tier-track"
          data-tier={tier}
          data-reveal="rise"
          data-reveal-delay="60"
        >
          <span className="feat__tier-thumb" aria-hidden="true" />
          {TIERS.map((value) => (
            <label className="feat__tier" key={value}>
              <input
                className="feat__tier-input"
                type="radio"
                name={`${id}-tier`}
                value={value}
                checked={tier === value}
                onChange={() => setTier(value)}
                aria-describedby={`${id}-${value}`}
              />
              <span className="feat__tier-label">{options[value].label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="feat__tier-notes" data-reveal="rise" data-reveal-delay="200">
        {TIERS.map((value) => (
          <p
            className="feat__tier-note"
            id={`${id}-${value}`}
            key={value}
            data-active={tier === value ? '' : undefined}
          >
            {options[value].description}
          </p>
        ))}
      </div>
      <p className="feat__allowlist" data-reveal="rise" data-reveal-delay="280">
        <span className="feat__allowlist-label mono-label">{allowlistLabel}</span>
        <span>{allowlist}</span>
      </p>
    </div>
  );
}
