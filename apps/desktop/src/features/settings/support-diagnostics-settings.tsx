import { useTranslation } from 'react-i18next';
import { Download, Play } from 'lucide-react';
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
  const busy = diagnostics.status === 'exporting' || diagnostics.status === 'starting';
  const title = !diagnostics.recording
    ? 'supportDiagnostics.stoppedTitle'
    : !diagnostics.ready
      ? 'supportDiagnostics.permissionTitle'
      : diagnostics.focus
        ? 'supportDiagnostics.focusTitle'
        : 'supportDiagnostics.title';
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
                <ItemTitle>{t(title)}</ItemTitle>
                <ItemDescription id="support-diagnostics-description" className="whitespace-normal">
                  {t(
                    diagnostics.recording
                      ? 'supportDiagnostics.description'
                      : 'supportDiagnostics.stoppedDescription',
                  )}
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
                  onClick={() =>
                    void (diagnostics.recording
                      ? diagnostics.exportReport()
                      : diagnostics.startRecording())
                  }
                >
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : diagnostics.recording ? (
                    <Download data-icon="inline-start" />
                  ) : (
                    <Play data-icon="inline-start" />
                  )}
                  {t(
                    diagnostics.status === 'exporting'
                      ? 'supportDiagnostics.exporting'
                      : diagnostics.status === 'starting'
                        ? 'supportDiagnostics.starting'
                        : diagnostics.recording
                          ? 'supportDiagnostics.export'
                          : 'supportDiagnostics.start',
                  )}
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
              {diagnostics.recording && !diagnostics.ready && (
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
              {diagnostics.recording && diagnostics.permissionFailed && (
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
              {diagnostics.status === 'cleanupFailed' && (
                <ItemFooter role="alert" className="settings-inline-error">
                  {t('supportDiagnostics.cleanupFailed')}
                </ItemFooter>
              )}
              {diagnostics.status === 'startFailed' && (
                <ItemFooter role="alert" className="settings-inline-error">
                  {t('supportDiagnostics.startFailed')}
                </ItemFooter>
              )}
              {diagnostics.status === 'cancelled' && (
                <ItemFooter>
                  <output>{t('supportDiagnostics.cancelled')}</output>
                </ItemFooter>
              )}
            </li>
          </Item>
        </ItemGroup>
      </Card>
    </section>
  );
}
