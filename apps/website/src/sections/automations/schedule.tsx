import { useId, useState } from 'react';
import { PRESET_IDS, RULES, type PresetId, type RuleKind } from './presets';
import { Week } from './week';
import './schedule.css';

interface ScheduleProps {
  legend: string;
  presets: Record<PresetId, { label: string; description: string }>;
  ruleKinds: Record<RuleKind, string>;
  days: readonly string[];
  triggersLabel: string;
  triggers: readonly string[];
}

/**
 * The schedule panel: picking an example lights the hours it runs in on the week grid and states its
 * rule. The panel lifts in; its examples, the grid, the rule readout and the trigger list are their
 * own reveal groups, so each plays as it arrives rather than below the fold.
 */
export function Schedule({
  legend,
  presets,
  ruleKinds,
  days,
  triggersLabel,
  triggers,
}: ScheduleProps) {
  const [preset, setPreset] = useState<PresetId>('hourly');
  const id = useId();
  const rule = RULES[preset];
  const kind = ruleKinds[rule.kind];

  return (
    <div className="auto__panel" data-reveal="lift" data-spotlight="">
      <fieldset className="auto__presets" data-reveal-group="">
        <legend className="auto__legend mono-label" data-reveal="fade" data-reveal-delay="200">
          {legend}
        </legend>
        <div className="auto__options">
          {PRESET_IDS.map((value, index) => (
            <label
              className="auto__option"
              key={value}
              data-reveal="rise"
              data-reveal-delay={260 + index * 70}
            >
              <input
                className="auto__radio"
                type="radio"
                name={`${id}-preset`}
                value={value}
                checked={preset === value}
                onChange={() => setPreset(value)}
              />
              <span className="auto__pill">{presets[value].label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Week preset={preset} days={days} />

      {/* The rule types in, and a new example's rule replaces it (which stops the effect). The
          typed text is hidden from assistive tech, so the live region announces the rule once, from
          its hidden twin, rather than every frame of the effect. */}
      <div className="auto__rule" aria-live="polite" data-reveal-group="">
        <span className="auto__hairline" aria-hidden="true" data-reveal="draw" />
        <p className="auto__rule-line">
          <span
            className="auto__rule-kind mono-label"
            aria-hidden="true"
            data-reveal="decode"
            data-reveal-delay="120"
          >
            {kind}
          </span>
          <code
            className="auto__rule-text"
            aria-hidden="true"
            data-reveal="type"
            data-reveal-delay="200"
          >
            {rule.text}
          </code>
          <span className="sr-only">{`${kind} ${rule.text}`}</span>
        </p>
        <p className="auto__rule-description" data-reveal="rise" data-reveal-delay="460">
          {presets[preset].description}
        </p>
      </div>

      <div className="auto__triggers" data-reveal-group="">
        <p className="mono-label" data-reveal="decode">
          {triggersLabel}
        </p>
        <ul className="auto__trigger-list">
          {triggers.map((trigger, index) => (
            <li
              className="auto__trigger"
              key={trigger}
              data-reveal="rise"
              data-reveal-delay={100 + index * 45}
            >
              {trigger}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
