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
import { useSupportDiagnostics } from './use-support-diagnostics';

/** This support-only section is absent from ordinary builds. */
export function SupportDiagnosticsSettings() {
  const { t } = useTranslation('settings');
  const diagnostics = useSupportDiagnostics();
  if (!diagnostics.enabled) return null;
  const busy = diagnostics.status === 'exporting';
  return (
    <section className="settings-shortcut-group" aria-labelledby="support-diagnostics-heading">
      <h3 id="support-diagnostics-heading" className="settings-section-title">
        {t('supportDiagnostics.group')}
      </h3>
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <Item asChild size="sm" className="settings-card-row">
            <li>
              <ItemContent className="min-w-[min(200px,100%)]">
                <ItemTitle>
                  {diagnostics.ready
                    ? t(
                        diagnostics.focus
                          ? 'supportDiagnostics.focusTitle'
                          : 'supportDiagnostics.title',
                      )
                    : t('supportDiagnostics.permissionTitle')}
                </ItemTitle>
                <ItemDescription id="support-diagnostics-description" className="whitespace-normal">
                  {t('supportDiagnostics.description')}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="ml-auto">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-busy={busy}
                  aria-describedby="support-diagnostics-description"
                  onClick={() => void diagnostics.exportReport()}
                >
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  {busy ? t('supportDiagnostics.exporting') : t('supportDiagnostics.export')}
                </Button>
              </ItemActions>
              <ItemFooter className="min-w-0 items-start justify-start">
                <p className="text-sm text-muted-foreground">
                  {t(
                    diagnostics.focus
                      ? 'supportDiagnostics.focusPrivacy'
                      : 'supportDiagnostics.privacy',
                  )}
                </p>
              </ItemFooter>
              {!diagnostics.ready && (
                <ItemFooter className="min-w-0 flex-wrap gap-2">
                  <p className="flex-1 text-sm text-muted-foreground">
                    {t('supportDiagnostics.permissionHint')}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={diagnostics.preparing || busy}
                    onClick={() => void diagnostics.preparePermissions()}
                  >
                    {t('supportDiagnostics.authorize')}
                  </Button>
                </ItemFooter>
              )}
              {diagnostics.permissionFailed && (
                <ItemFooter role="alert" className="settings-inline-error">
                  {t('supportDiagnostics.permissionFailed')}
                </ItemFooter>
              )}
              {diagnostics.status === 'saved' && (
                <ItemFooter>
                  <output>{t('supportDiagnostics.saved')}</output>
                </ItemFooter>
              )}
              {diagnostics.status === 'failed' && (
                <ItemFooter role="alert" className="settings-inline-error">
                  {t('supportDiagnostics.failed')}
                </ItemFooter>
              )}
            </li>
          </Item>
        </ItemGroup>
      </Card>
    </section>
  );
}
