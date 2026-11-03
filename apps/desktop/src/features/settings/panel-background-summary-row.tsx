import { useId, type CSSProperties } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@atd/ui/components/item';
import { DEFAULT_PANEL_BACKGROUND, type PanelBackground } from '../../client/settings-contract';
import { useColorScheme } from '../../theme/color-scheme';
import {
  isDefaultPanelBackground,
  panelSurface,
  shownOpacity,
  type Theme,
} from '../../theme/panel-background/derive';
import { useSystemAppearance } from '../../theme/panel-background/system-appearance';
import type { PanelBackgroundSettings } from './use-panel-background';
import '../../components/open-row.css';

const GLASS_TUNINGS = ['blur', 'refractionWidth', 'refractionStrength'] as const;
const grayHex = (level: number) => `#${level.toString(16).padStart(2, '0').repeat(3)}`;

/**
 * What the row says is set in `theme`: "Default" and the transparency while nothing differs from
 * the recipe, else the transparency and only what differs. Glass changes count only where the
 * windows have Liquid Glass, since nothing else shows them.
 */
function summarize(
  t: TFunction<'settings'>,
  theme: Theme,
  value: PanelBackground,
  liquidGlass: boolean,
) {
  const transparency = 100 - shownOpacity(theme, value);
  if (isDefaultPanelBackground(value))
    return t('panelBackground.summary.default', { transparency });
  const parts = [
    transparency === 0
      ? t('panelBackground.transparency.solid')
      : t('panelBackground.summary.transparent', { value: transparency }),
  ];
  if (value.tone[theme] !== DEFAULT_PANEL_BACKGROUND.tone[theme])
    parts.push(t('panelBackground.summary.tone', { hex: grayHex(value.tone[theme]) }));
  if (value.tint !== DEFAULT_PANEL_BACKGROUND.tint)
    parts.push(t(`panelBackground.tint.options.${value.tint}`));
  if (liquidGlass && value.glass !== DEFAULT_PANEL_BACKGROUND.glass)
    parts.push(t('panelBackground.summary.clearGlass'));
  if (liquidGlass && GLASS_TUNINGS.some((key) => value[key] !== DEFAULT_PANEL_BACKGROUND[key]))
    parts.push(t('panelBackground.summary.glassAdjusted'));
  return parts.join(' · ');
}

/**
 * General › Appearance: the panel background as one row that opens its sub-page
 * (`PanelBackgroundPage`). A button fills the row (`open-row`); the description says what is set
 * for the current appearance, and a swatch of the current fill over a colorful backdrop shows how
 * see-through it is.
 */
export function PanelBackgroundSummaryRow({
  settings,
  onOpen,
}: {
  settings: PanelBackgroundSettings;
  onOpen: () => void;
}) {
  const { t } = useTranslation('settings');
  const theme = useColorScheme();
  const { accentColor, liquidGlass } = useSystemAppearance();
  const ids = useId();
  const fill = panelSurface(theme, settings.value, accentColor).fill;
  return (
    <Item asChild size="sm" className="settings-card-row settings-panel-summary open-row">
      <li data-settings-anchor="settings-panel-background">
        <button
          type="button"
          className="open-row-button"
          aria-labelledby={`${ids}-title`}
          aria-describedby={`${ids}-summary`}
          onClick={onOpen}
        />
        {/* The swatch and chevron are small, so they stay beside the text at every width. */}
        <ItemContent>
          <ItemTitle id={`${ids}-title`} className="whitespace-normal">
            {t('panelBackground.title')}
          </ItemTitle>
          <ItemDescription id={`${ids}-summary`} className="whitespace-normal">
            {summarize(t, theme, settings.value, liquidGlass)}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto">
          <span
            className="settings-panel-swatch"
            // The fill as data: settings.css lays it over the swatch's backdrop.
            style={{ '--panel-swatch-fill': fill } as CSSProperties}
            aria-hidden="true"
          />
          <ChevronRight className="settings-panel-chevron" aria-hidden="true" />
        </ItemActions>
      </li>
    </Item>
  );
}
