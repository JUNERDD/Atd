import { useTranslation } from 'react-i18next';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import {
  DEFAULT_PANEL_BACKGROUND,
  PANEL_GLASS_TUNING_RANGE,
  PANEL_GLASS_VARIANTS,
} from '../../client/settings-contract';
import { PanelBackgroundRow, PanelBackgroundSlider } from './panel-background-row';
import type { PanelBackgroundSettings } from './use-panel-background';

type Tuning = keyof typeof PANEL_GLASS_TUNING_RANGE;
const TUNINGS = ['blur', 'refractionWidth', 'refractionStrength'] as const satisfies Tuning[];
const toVariant = (value: string) =>
  PANEL_GLASS_VARIANTS.find((variant) => variant === value) ?? null;

/**
 * The Liquid Glass card of General › Panel background: the glass variant, then blur and the edge
 * refraction relative to the system's own values, in tenths. Refraction reads as a multiple;
 * blur as a strength in percent, since above 100% it rises to a radius that conceals text behind
 * the glass rather than multiplying the system's (`PANEL_GLASS_TUNING_RANGE`). Shown only where
 * the windows stand on Liquid Glass (macOS 26); the settings apply to both appearances.
 */
export function PanelBackgroundGlass({ settings }: { settings: PanelBackgroundSettings }) {
  const { t } = useTranslation('settings');
  const { value, unavailable, errorFor, change } = settings;
  const label = (tuning: Tuning, factor: number) => {
    if (factor === 1) return t('panelBackground.system');
    return tuning === 'blur'
      ? t('panelBackground.percent', { value: Math.round(factor * 100) })
      : t('panelBackground.multiplier', { value: factor.toFixed(1) });
  };
  return (
    <section className="settings-shortcut-group" aria-labelledby="settings-panel-background-glass">
      <h3 id="settings-panel-background-glass" className="settings-section-title">
        {t('panelBackground.groups.glass')}
      </h3>
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <PanelBackgroundRow
            title={t('panelBackground.variant.title')}
            description={t('panelBackground.variant.description')}
            anchor="panel-background-variant"
            error={errorFor('variant')}
            changed={value.glass !== DEFAULT_PANEL_BACKGROUND.glass}
            disabled={unavailable}
            onReset={() => change({ ...value, glass: DEFAULT_PANEL_BACKGROUND.glass }, 'variant')}
          >
            <Select
              value={value.glass}
              disabled={unavailable}
              onValueChange={(next) => {
                const glass = toVariant(next);
                if (glass) change({ ...value, glass }, 'variant');
              }}
            >
              <SelectTrigger size="sm" aria-label={t('panelBackground.variant.title')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PANEL_GLASS_VARIANTS.map((variant) => (
                  <SelectItem key={variant} value={variant}>
                    {t(`panelBackground.variant.options.${variant}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PanelBackgroundRow>
          {TUNINGS.map((tuning) => (
            <PanelBackgroundRow
              key={tuning}
              title={t(`panelBackground.${tuning}.title`)}
              description={t(`panelBackground.${tuning}.description`)}
              anchor={`panel-background-${tuning}`}
              error={errorFor(tuning)}
              changed={value[tuning] !== DEFAULT_PANEL_BACKGROUND[tuning]}
              disabled={unavailable}
              onReset={() =>
                change({ ...value, [tuning]: DEFAULT_PANEL_BACKGROUND[tuning] }, tuning)
              }
            >
              <PanelBackgroundSlider
                label={t(`panelBackground.${tuning}.title`)}
                value={value[tuning]}
                min={PANEL_GLASS_TUNING_RANGE[tuning][0]}
                max={PANEL_GLASS_TUNING_RANGE[tuning][1]}
                step={0.1}
                text={label(tuning, value[tuning])}
                disabled={unavailable}
                onChange={(next) => {
                  // Radix steps in floating point; the setting keeps tenths.
                  const factor = Math.round(next * 10) / 10;
                  if (factor !== value[tuning]) change({ ...value, [tuning]: factor }, tuning);
                }}
              />
            </PanelBackgroundRow>
          ))}
        </ItemGroup>
      </Card>
      <p className="settings-field-note">{t('panelBackground.glassNote')}</p>
    </section>
  );
}
