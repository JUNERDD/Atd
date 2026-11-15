import { Monitor, Moon, Sun } from 'lucide-react';
import { useId } from 'react';
import { setThemePreference, type ThemePreference, useThemePreference } from '../../lib/theme';
import './theme-switch.css';

export interface ThemeSwitchLabels {
  label: string;
  system: string;
  light: string;
  dark: string;
}

const OPTIONS: readonly { value: ThemePreference; Icon: typeof Monitor }[] = [
  { value: 'system', Icon: Monitor },
  { value: 'light', Icon: Sun },
  { value: 'dark', Icon: Moon },
];

export function ThemeSwitch({ labels }: { labels: ThemeSwitchLabels }) {
  const preference = useThemePreference();
  const groupName = useId();

  return (
    <fieldset className="theme-switch">
      <legend className="sr-only">{labels.label}</legend>
      {OPTIONS.map(({ value, Icon }) => {
        const checked = preference === value;
        const text = labels[value];
        return (
          <label key={value} className="theme-switch__btn" title={text}>
            <input
              type="radio"
              name={groupName}
              value={value}
              checked={checked}
              className="theme-switch__input"
              aria-label={text}
              onChange={() => setThemePreference(value)}
            />
            <Icon className="theme-switch__icon" size={14} strokeWidth={1.85} aria-hidden="true" />
          </label>
        );
      })}
    </fieldset>
  );
}
