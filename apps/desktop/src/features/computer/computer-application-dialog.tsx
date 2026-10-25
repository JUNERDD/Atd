import { useState } from 'react';
import { AppWindow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ComputerPrepareResult } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atd/ui/components/dialog';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import { Spinner } from '@atd/ui/components/spinner';
import { showErrorToast } from '../../components/toast-store';
import { messageOf } from '../../lib/errors';
import { FieldError } from '../commands/field-error';
import { ComputerProbeResult, type ComputerProbe } from './computer-probe-result';
import { computerBridge } from './use-computer';

type Prepared = Extract<ComputerPrepareResult, { ok: true }>;

/**
 * Add application: a name and the app Atd works in, picked in the shell's own app picker; Add asks
 * the shell to locate and check the app and register it. The shell answers with a read-only probe
 * (its open windows, and whether its controls and window pictures were readable), which the
 * dialog shows before Done, since a missing permission or no open window explains why a later
 * task cannot act yet. The probe never opens or activates the app. Closing the picker keeps the
 * dialog open, so the person can choose again or cancel.
 */
export function ComputerApplicationDialog({
  open,
  onOpenChange,
  onPrepared,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPrepared: (result: ComputerPrepareResult) => void;
}) {
  const { t } = useTranslation('settings');
  const [label, setLabel] = useState('');
  const [app, setApp] = useState<{ bundleId: string; name: string } | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState<{ result: Prepared; probe: ComputerProbe } | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLabel('');
      setApp(null);
      setLabelError(null);
      setFailure(null);
      setAdded(null);
    }
  }
  async function chooseApp() {
    try {
      const picked = await computerBridge()?.pickApp();
      if (picked) {
        setApp(picked);
        setFailure(null);
      }
    } catch (error) {
      showErrorToast(error);
    }
  }
  async function add() {
    if (pending) return;
    const name = label.trim();
    setLabelError(name ? null : t('computer.application.errors.label'));
    setFailure(app ? null : t('computer.application.errors.app'));
    const bridge = computerBridge();
    if (!name || !app || !bridge) return;
    setPending(true);
    try {
      const result = await bridge.prepareApplication({ label: name, bundleId: app.bundleId });
      setPending(false);
      if (result.ok && result.probe) setAdded({ result, probe: result.probe });
      else if (result.ok) onPrepared(result);
      else if (result.reason === 'unsupported')
        setFailure(t('computer.application.errors.unsupported'));
      else if (result.reason !== 'cancelled')
        setFailure(t(`computer.prepareFailed.${result.reason}`));
    } catch (error) {
      setPending(false);
      setFailure(messageOf(error));
    }
  }
  // The target exists once added: closing the probe in any way finishes like Done.
  const close = (next: boolean) => {
    if (pending) return;
    if (!next && added) onPrepared(added.result);
    else onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="panel-dialog">
        {added ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {t('computer.application.probe.title', { name: label.trim() })}
              </DialogTitle>
              <DialogDescription className="whitespace-normal">
                {t('computer.application.probe.description')}
              </DialogDescription>
            </DialogHeader>
            <ComputerProbeResult probe={added.probe} />
            <DialogFooter>
              <Button onClick={() => close(false)}>{t('computer.application.probe.done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('computer.application.title')}</DialogTitle>
              <DialogDescription className="whitespace-normal">
                {t('computer.application.description')}
              </DialogDescription>
            </DialogHeader>
            <div className="settings-field">
              <Label htmlFor="computer-application-label">{t('computer.application.label')}</Label>
              <Input
                id="computer-application-label"
                value={label}
                maxLength={120}
                placeholder={t('computer.application.labelPlaceholder')}
                disabled={pending}
                aria-invalid={Boolean(labelError) || undefined}
                aria-describedby={labelError ? 'computer-application-label-error' : undefined}
                onChange={(event) => setLabel(event.target.value)}
              />
              {labelError && (
                <FieldError id="computer-application-label-error">{labelError}</FieldError>
              )}
            </div>
            <div className="settings-field">
              <Label id="computer-application-app-label">{t('computer.application.app')}</Label>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span
                  id="computer-application-app-name"
                  className="min-w-0 flex-1 truncate text-sm data-[empty]:text-muted-foreground"
                  data-empty={app ? undefined : ''}
                >
                  {app?.name ?? t('computer.application.noApp')}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  aria-describedby="computer-application-app-label computer-application-app-name"
                  onClick={() => void chooseApp()}
                >
                  {t('computer.application.chooseApp')}
                </Button>
              </div>
            </div>
            {failure && <FieldError id="computer-application-failure">{failure}</FieldError>}
            <DialogFooter>
              <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
                {t('computer.cancel')}
              </Button>
              <Button
                aria-busy={pending || undefined}
                disabled={pending}
                onClick={() => void add()}
              >
                {pending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <AppWindow data-icon="inline-start" />
                )}
                {t('computer.application.add')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
