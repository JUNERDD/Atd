import { Fragment, useId, useState } from 'react';
import { DAYS, HOURS, PRESET_IDS, RULES, runsAt, type PresetId, type RuleKind } from './presets';
import './schedule.css';

const HOUR_LABELS = ['00', '06', '12', '18'];

interface ScheduleProps {
  legend: string;
  presets: Record<PresetId, { label: string; description: string }>;
  ruleKinds: Record<RuleKind, string>;
  days: readonly string[];
  triggersLabel: string;
  triggers: readonly string[];
}

/**
 * The week as a dot matrix, Monday to Sunday by hour. Picking an example lights the hours it runs in,
 * sweeping left to right (each 3-hour band is a `data-step`, 20 ms apart), and states its rule.
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

  return (
    <div className="auto__panel reveal">
      <fieldset className="auto__presets">
        <legend className="auto__legend mono-label">{legend}</legend>
        <div className="auto__options">
          {PRESET_IDS.map((value) => (
            <label className="auto__option" key={value}>
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

      <div className="auto__week" aria-hidden="true">
        <span />
        {HOUR_LABELS.map((label) => (
          <span className="auto__hour" key={label}>
            {label}
          </span>
        ))}
        {days.slice(0, DAYS).map((day, dayIndex) => (
          <Fragment key={day}>
            <span className="auto__day">{day}</span>
            {Array.from({ length: HOURS }, (_, hour) => (
              <span
                className="auto__cell"
                key={hour}
                data-step={Math.floor(hour / 3)}
                data-on={runsAt(preset, dayIndex, hour) ? '' : undefined}
              />
            ))}
          </Fragment>
        ))}
      </div>

      <div className="auto__rule" aria-live="polite">
        <p className="auto__rule-line">
          <span className="auto__rule-kind mono-label">{ruleKinds[rule.kind]}</span>
          <code className="auto__rule-text">{rule.text}</code>
        </p>
        <p className="auto__rule-description">{presets[preset].description}</p>
      </div>

      <div className="auto__triggers">
        <p className="mono-label">{triggersLabel}</p>
        <ul className="auto__trigger-list">
          {triggers.map((trigger) => (
            <li className="auto__trigger" key={trigger}>
              {trigger}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
