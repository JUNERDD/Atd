import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import {
  DEFAULT_PANEL_BACKGROUND,
  PANEL_TINTS,
  PANEL_TONE_RANGE,
  type PanelTint,
} from '../../client/settings-contract';
import {
  opacityLimits,
  panelSurface,
  shownOpacity,
  tintSwatch,
  type Theme,
} from '../../theme/panel-background/derive';
import { PanelBackgroundRow, PanelBackgroundSlider } from './panel-background-row';
import type { PanelBackgroundSettings } from './use-panel-background';

/**
 * The Background card of General › Panel background. Transparency and tone edit `theme`, the
 * appearance the app shows now; the other keeps its own values. Transparency is the inverse of
 * the fill's opacity and stops at the most transparent fill the tone and glass variant allow, so
 * a stored opacity below that limit reads as the limit. The tint applies to both appearances.
 */
export function PanelBackgroundRows({
  settings,
  theme,
  accentColor,
}: {
  settings: PanelBackgroundSettings;
  theme: Theme;
  /** The system accent, whose hue the `accent` tint takes. */
  accentColor: string;
}) {
  const { t } = useTranslation('settings');
  const { value, unavailable, errorFor, change } = settings;
  const transparency = 100 - shownOpacity(theme, value);
  // Gray levels, darkest first: further right is lighter.
  const [darkest, lightest] = PANEL_TONE_RANGE[theme];
  const tintName = (tint: PanelTint) => t(`panelBackground.tint.options.${tint}`);
  return (
    <>
      <PanelBackgroundRow
        title={t('panelBackground.transparency.title')}
        description={t('panelBackground.transparency.description')}
        anchor="panel-background-transparency"
        error={errorFor('transparency')}
        changed={value.opacity[theme] !== DEFAULT_PANEL_BACKGROUND.opacity[theme]}
        disabled={unavailable}
        onReset={() =>
          change(
            {
              ...value,
              opacity: { ...value.opacity, [theme]: DEFAULT_PANEL_BACKGROUND.opacity[theme] },
            },
            'transparency',
          )
        }
      >
        <PanelBackgroundSlider
          label={t('panelBackground.transparency.title')}
          value={transparency}
          min={0}
          max={100 - opacityLimits(theme, value).minimum}
          step={1}
          text={
            transparency === 0
              ? t('panelBackground.transparency.solid')
              : t('panelBackground.percent', { value: transparency })
          }
          disabled={unavailable}
          onChange={(next) =>
            change({ ...value, opacity: { ...value.opacity, [theme]: 100 - next } }, 'transparency')
          }
        />
      </PanelBackgroundRow>
      <PanelBackgroundRow
        title={t('panelBackground.tone.title')}
        description={t('panelBackground.tone.description')}
        anchor="panel-background-tone"
        error={errorFor('tone')}
        changed={value.tone[theme] !== DEFAULT_PANEL_BACKGROUND.tone[theme]}
        disabled={unavailable}
        onReset={() =>
          change(
            { ...value, tone: { ...value.tone, [theme]: DEFAULT_PANEL_BACKGROUND.tone[theme] } },
            'tone',
          )
        }
      >
        <PanelBackgroundSlider
          label={t('panelBackground.tone.title')}
          value={value.tone[theme]}
          min={darkest}
          max={lightest}
          step={1}
          text={panelSurface(theme, value, accentColor).hex}
          disabled={unavailable}
          onChange={(next) => change({ ...value, tone: { ...value.tone, [theme]: next } }, 'tone')}
        />
      </PanelBackgroundRow>
      <PanelBackgroundRow
        title={t('panelBackground.tint.title')}
        description={t('panelBackground.tint.description')}
        anchor="panel-background-tint"
        error={errorFor('tint')}
        changed={value.tint !== DEFAULT_PANEL_BACKGROUND.tint}
        disabled={unavailable}
        onReset={() => change({ ...value, tint: DEFAULT_PANEL_BACKGROUND.tint }, 'tint')}
      >
        {/* Native radios: arrow keys move the choice and Tab enters at the chosen swatch. */}
        <div
          className="settings-panel-tints"
          role="radiogroup"
          aria-label={t('panelBackground.tint.title')}
        >
          {PANEL_TINTS.map((tint) => (
            <Tooltip key={tint}>
              <TooltipTrigger asChild>
                <input
                  type="radio"
                  name="settings-panel-background-tint"
                  value={tint}
                  aria-label={tintName(tint)}
                  className="settings-panel-tint"
                  data-tint={tint}
                  // The hue as data: settings.css paints the swatch from it.
                  style={{ '--panel-tint-swatch': tintSwatch(tint, accentColor) } as CSSProperties}
                  checked={value.tint === tint}
                  disabled={unavailable}
                  onChange={() => change({ ...value, tint }, 'tint')}
                />
              </TooltipTrigger>
              <TooltipContent>{tintName(tint)}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </PanelBackgroundRow>
    </>
  );
}
