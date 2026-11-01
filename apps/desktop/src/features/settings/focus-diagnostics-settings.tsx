import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemTitle,
} from '@atd/ui/components/item';
import { Spinner } from '@atd/ui/components/spinner';
import { useFocusDiagnostics } from './use-focus-diagnostics';

/** This support-only section is absent from ordinary builds. */
export function FocusDiagnosticsSettings() {
  const { t } = useTranslation('settings');
  const diagnostics = useFocusDiagnostics();
  if (!diagnostics.enabled) return null;
  const busy = diagnostics.status === 'exporting';
  return (
    <section className="settings-shortcut-group" aria-labelledby="focus-diagnostics-heading">
      <h3 id="focus-diagnostics-heading" className="settings-section-title">
        {t('focusDiagnostics.group')}
      </h3>
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <Item asChild size="sm" className="settings-card-row">
            <li>
              <ItemContent className="min-w-[min(200px,100%)]">
                <ItemTitle>{t('focusDiagnostics.title')}</ItemTitle>
                <ItemDescription id="focus-diagnostics-description" className="whitespace-normal">
                  {t('focusDiagnostics.description')}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="ml-auto">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-busy={busy}
                  aria-describedby="focus-diagnostics-description"
                  onClick={() => void diagnostics.exportReport()}
                >
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  {busy ? t('focusDiagnostics.exporting') : t('focusDiagnostics.export')}
                </Button>
              </ItemActions>
              <ItemFooter className="min-w-0 items-start justify-start">
                <p className="text-sm text-muted-foreground">{t('focusDiagnostics.privacy')}</p>
              </ItemFooter>
              {diagnostics.status === 'saved' && (
                <ItemFooter>
                  <output>{t('focusDiagnostics.saved')}</output>
                </ItemFooter>
              )}
              {diagnostics.status === 'failed' && (
                <ItemFooter role="alert" className="settings-inline-error">
                  {t('focusDiagnostics.failed')}
                </ItemFooter>
              )}
            </li>
          </Item>
        </ItemGroup>
      </Card>
    </section>
  );
}
