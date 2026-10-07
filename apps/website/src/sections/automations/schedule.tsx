import { useId, useState } from 'react';
import { PRESET_IDS, RULES, type PresetId, type RuleKind } from './presets';
import { Week } from './week';
import './schedule.css';

interface ScheduleProps {
  legend: string;
  presets: Record<PresetId, string>;
  ruleKinds: Record<RuleKind, string>;
  days: readonly string[];
}

/**
 * The schedule: example keys and the rule they stand for, beside the week as an LED matrix. Picking
 * an example lights the hours it runs in and types its rule into the readout. On wide plates the
 * keys sit in the legend column. The keys and the readout are one reveal group, the matrix another,
 * so each plays as it arrives.
 */
export function Schedule({ legend, presets, ruleKinds, days }: ScheduleProps) {
  const [preset, setPreset] = useState<PresetId>('hourly');
  const id = useId();
  const rule = RULES[preset];
  const kind = ruleKinds[rule.kind];

  return (
    <div className="auto__stage">
      <div className="auto__controls" data-reveal-group="" data-reveal-stagger="80">
        <fieldset className="auto__presets">
          <legend className="auto__legend legend" data-reveal="fade">
            {legend}
          </legend>
          <div className="auto__keys">
            {PRESET_IDS.map((value) => (
              <label className="auto__key" key={value} data-reveal="rise">
                <input
                  className="auto__radio"
                  type="radio"
                  name={`${id}-preset`}
                  value={value}
                  checked={preset === value}
                  onChange={() => setPreset(value)}
                />
                <span className="auto__key-face">
                  <span className="auto__lamp" aria-hidden="true" />
                  {presets[value]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* The rule types in, and a new example's rule replaces it (which stops the effect). The
            typed text is hidden from assistive tech, so the live region announces the rule once,
            from its hidden twin, rather than every frame of the effect. */}
        <p className="auto__rule display" aria-live="polite" data-reveal="power">
          <span className="legend" aria-hidden="true">
            {kind}
          </span>
          <code className="auto__rule-text" aria-hidden="true" data-reveal="type">
            {rule.text}
          </code>
          <span className="sr-only">{`${kind} ${rule.text}`}</span>
        </p>
      </div>

      <Week preset={preset} days={days} />
    </div>
  );
}
