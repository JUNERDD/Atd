import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@atd/ui/components/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@atd/ui/components/alert-dialog';
import { Button } from '@atd/ui/components/button';
import { Spinner } from '@atd/ui/components/spinner';
import type { ComputerShellState } from '../../client/computer-contract';
import { messageOf } from '../../lib/errors';
import { FieldError } from '../commands/field-error';
import { computerBridge } from './use-computer';

/**
 * Background computer use is paused: the host holds actions whose effect nobody could confirm and
 * no service record settled. Only a person who checked the affected apps and sites may resume it,
 * so "I've checked" asks for that confirmation first. The notice leaves once the shell reports
 * nothing unsettled, which is the outcome; a failure stays in the dialog.
 */
export function ComputerUnsettledNotice({ shell }: { shell: ComputerShellState | null }) {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const unsettled = shell?.unsettled;
  const bridge = computerBridge();
  if (!unsettled?.count || !bridge) return null;
  const actionIds = unsettled.actionIds;
  async function acknowledge() {
    if (pending || !bridge || !actionIds.length) return;
    setPending(true);
    setFailure(null);
    try {
      await bridge.acknowledgeUnsettled(actionIds);
      setOpen(false);
    } catch (error) {
      setFailure(messageOf(error));
    }
    setPending(false);
  }
  return (
    <>
      <Alert data-settings-anchor="computer-unsettled">
        <TriangleAlert />
        <AlertTitle>{t('computer.unsettled.title')}</AlertTitle>
        <AlertDescription>
          {t('computer.unsettled.description', { count: unsettled.count })}
        </AlertDescription>
        <AlertAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!actionIds.length}
            onClick={() => {
              setFailure(null);
              setOpen(true);
            }}
          >
            {t('computer.unsettled.review')}
          </Button>
        </AlertAction>
      </Alert>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('computer.unsettled.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('computer.unsettled.confirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {failure && <FieldError id="computer-unsettled-failure">{failure}</FieldError>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t('computer.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              aria-busy={pending || undefined}
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                void acknowledge();
              }}
            >
              {pending && <Spinner data-icon="inline-start" />}
              {t('computer.unsettled.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
