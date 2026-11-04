import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { DEFAULT_PANEL_BACKGROUND } from '../../client/settings-contract';
import { useColorScheme } from '../../theme/color-scheme';
import { isDefaultPanelBackground } from '../../theme/panel-background/derive';
import { useSystemAppearance } from '../../theme/panel-background/system-appearance';
import { PanelBackgroundGlass } from './panel-background-glass';
import { PanelBackgroundRows } from './panel-background-rows';
import { SettingsHeading } from './settings-heading';
import type { PanelBackgroundSettings } from './use-panel-background';

/**
 * General › Panel background, a sub-page of General's history: the fill (transparency and tone of
 * the current appearance, the tint), the Liquid Glass parameters where the windows have Liquid
 * Glass, and Restore defaults for all of it. Every control saves at once, so the open panel and
 * this window show each change live.
 */
export function PanelBackgroundPage({ settings }: { settings: PanelBackgroundSettings }) {
  const { t } = useTranslation('settings');
  const theme = useColorScheme();
  const { accentColor, liquidGlass } = useSystemAppearance();
  const groups = useRef<HTMLDivElement>(null);
  // The page flows in the window's scroller, so it opens at its top like a section does; a search
  // reveal scrolls to its row afterwards.
  useLayoutEffect(() => {
    const viewport = groups.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (viewport) viewport.scrollTop = 0;
  }, []);
  const unchanged = isDefaultPanelBackground(settings.value);
  const restoreError = settings.errorFor('restore');
  return (
    <>
      <SettingsHeading
        subpage
        title={t('panelBackground.title')}
        description={t('panelBackground.description')}
        backLabel={t('panelBackground.back')}
      />
      <div ref={groups} className="settings-shortcut-groups">
        <section
          className="settings-shortcut-group"
          aria-labelledby="settings-panel-background-fill"
        >
          <h3 id="settings-panel-background-fill" className="settings-section-title">
            {t('panelBackground.groups.background')}
          </h3>
          <Card size="sm" className="settings-card">
            <ItemGroup>
              <PanelBackgroundRows settings={settings} theme={theme} accentColor={accentColor} />
            </ItemGroup>
          </Card>
          <p className="settings-field-note">{t(`panelBackground.scope.${theme}`)}</p>
        </section>
        {liquidGlass && <PanelBackgroundGlass settings={settings} />}
        <div className="settings-shortcut-restore">
          {restoreError && (
            <p
              id="settings-panel-background-restore-error"
              className="settings-inline-error"
              role="alert"
            >
              <CircleAlert aria-hidden="true" />
              <span>{restoreError}</span>
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="aria-disabled:opacity-50"
            data-settings-anchor="panel-background-restore"
            disabled={settings.unavailable}
            // Stays focusable once everything is default again, so focus does not drop away.
            aria-disabled={unchanged || undefined}
            aria-describedby={restoreError ? 'settings-panel-background-restore-error' : undefined}
            onClick={() => {
              if (!unchanged) settings.change(DEFAULT_PANEL_BACKGROUND, 'restore');
            }}
          >
            {t('panelBackground.restoreDefaults')}
          </Button>
        </div>
      </div>
    </>
  );
}
