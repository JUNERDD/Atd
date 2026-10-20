import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Textarea } from '@atd/ui/components/textarea';
import type { ComputerPrepareResult } from '@atd/agent-contracts';
import { messageOf } from '../../lib/errors';
import { FieldError } from '../commands/field-error';
import { readOrigins, toOrigin, toStartUrl } from './computer-target-words';
import { computerBridge } from './use-computer';

type Field = 'label' | 'startUrl' | 'origins';

/**
 * Add browser environment: a name, the page it opens at and the sites it may reach. Atd creates
 * its own Chrome profile for it, separate from the person's everyday one, and opens it for them
 * to sign in; the target is registered when they finish there, which this dialog waits for. The
 * sites default to the start page's own; a start page outside them is refused here, as the
 * service would refuse navigating to it.
 */
export function ComputerBrowserDialog({
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
  const [startUrl, setStartUrl] = useState('');
  const [origins, setOrigins] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLabel('');
      setStartUrl('');
      setOrigins('');
      setErrors({});
      setFailure(null);
    }
  }
  async function add() {
    if (pending) return;
    const url = toStartUrl(startUrl);
    const typed = readOrigins(origins);
    const own = toOrigin(startUrl);
    const allowed = 'origins' in typed && !typed.origins.length && own ? { origins: [own] } : typed;
    const next: Partial<Record<Field, string>> = {};
    if (!label.trim()) next.label = t('computer.browser.errors.label');
    if (!url) next.startUrl = t('computer.browser.errors.startUrl');
    if ('invalid' in allowed)
      next.origins = t('computer.browser.errors.origin', { entry: allowed.invalid });
    else if (own && !allowed.origins.includes(own))
      next.origins = t('computer.browser.errors.outside');
    setErrors(next);
    const bridge = computerBridge();
    if (Object.keys(next).length || !url || 'invalid' in allowed || !bridge) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await bridge.prepareBrowser({
        label: label.trim(),
        startUrl: url,
        allowedOrigins: allowed.origins,
      });
      setPending(false);
      if (result.ok || result.reason === 'cancelled') onPrepared(result);
      else setFailure(t(`computer.prepareFailed.${result.reason}`));
    } catch (error) {
      setPending(false);
      setFailure(messageOf(error));
    }
  }
  const field = (name: Field) => ({
    'aria-invalid': Boolean(errors[name]) || undefined,
    'aria-describedby': errors[name] ? `computer-browser-${name}-error` : undefined,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent className="panel-dialog">
        <DialogHeader>
          <DialogTitle>{t('computer.browser.title')}</DialogTitle>
          <DialogDescription className="whitespace-normal">
            {t('computer.browser.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="settings-field">
          <Label htmlFor="computer-browser-label">{t('computer.browser.label')}</Label>
          <Input
            id="computer-browser-label"
            value={label}
            maxLength={120}
            placeholder={t('computer.browser.labelPlaceholder')}
            disabled={pending}
            {...field('label')}
            onChange={(event) => setLabel(event.target.value)}
          />
          {errors.label && (
            <FieldError id="computer-browser-label-error">{errors.label}</FieldError>
          )}
        </div>
        <div className="settings-field">
          <Label htmlFor="computer-browser-start">{t('computer.browser.startUrl')}</Label>
          <Input
            id="computer-browser-start"
            value={startUrl}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.com/form"
            disabled={pending}
            {...field('startUrl')}
            onChange={(event) => setStartUrl(event.target.value)}
          />
          {errors.startUrl && (
            <FieldError id="computer-browser-startUrl-error">{errors.startUrl}</FieldError>
          )}
        </div>
        <div className="settings-field">
          <Label htmlFor="computer-browser-origins">{t('computer.browser.origins')}</Label>
          <Textarea
            id="computer-browser-origins"
            value={origins}
            rows={3}
            spellCheck={false}
            placeholder={toOrigin(startUrl) ?? 'https://example.com'}
            disabled={pending}
            {...field('origins')}
            onChange={(event) => setOrigins(event.target.value)}
          />
          <p className="settings-field-note">{t('computer.browser.originsNote')}</p>
          {errors.origins && (
            <FieldError id="computer-browser-origins-error">{errors.origins}</FieldError>
          )}
        </div>
        {pending && (
          <p className="settings-field-note" aria-live="polite">
            {t('computer.browser.waiting')}
          </p>
        )}
        {failure && <FieldError id="computer-browser-failure">{failure}</FieldError>}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {t('computer.cancel')}
          </Button>
          <Button aria-busy={pending || undefined} disabled={pending} onClick={() => void add()}>
            {pending && <Spinner data-icon="inline-start" />}
            {pending ? t('computer.browser.preparing') : t('computer.browser.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
