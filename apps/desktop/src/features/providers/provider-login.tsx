import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import type { LoginState } from '../../client/providers/schema';
import { showErrorToast } from '../../components/toast-store';

export function ProviderSignIn({
  connectionId,
  disabled,
}: {
  connectionId: string;
  disabled: boolean;
}) {
  const { t } = useTranslation('providers');
  const bridge = window.desktop?.settings.providers;
  const [state, setState] = useState<LoginState | null>(null);
  const [answer, setAnswer] = useState('');
  const prompt = useRef<HTMLDivElement>(null);
  const feedback = useRef<HTMLOutputElement>(null);
  const current = useRef(state);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    if (!bridge) return;
    const unsubscribe = bridge.onLogin((next) => {
      if (
        next.connectionId === connectionId &&
        (!current.current || current.current.id === next.id || current.current.status !== 'waiting')
      ) {
        const promptChanged = current.current?.prompt?.id !== next.prompt?.id;
        current.current = next;
        setState(next);
        if (promptChanged) setAnswer('');
      }
    });
    return () => {
      active.current = false;
      unsubscribe();
      if (current.current?.status === 'waiting') void bridge.cancel(current.current.id);
    };
  }, [bridge, connectionId]);
  async function action(operation: () => Promise<unknown>) {
    try {
      await operation();
    } catch (error) {
      showErrorToast(error);
    }
  }
  const waiting = state?.status === 'waiting';
  useEffect(() => {
    if (waiting) prompt.current?.querySelector<HTMLElement>('input, [role="combobox"]')?.focus();
  }, [state?.prompt?.id, waiting]);
  useEffect(() => {
    if (state?.status === 'error') feedback.current?.scrollIntoView({ block: 'nearest' });
  }, [state?.status]);
  return (
    <div className="provider-sign-in settings-field">
      {state && (
        <output
          ref={feedback}
          role={state.status === 'error' ? 'alert' : 'status'}
          className={state.status === 'error' ? 'text-destructive' : undefined}
        >
          {state.message}
        </output>
      )}
      {waiting && state.code && (
        <code className="text-lg tracking-widest select-all">{state.code}</code>
      )}
      {waiting && state.url && (
        <Button variant="outline" onClick={() => void action(() => bridge!.openLink(state.id))}>
          {t('login.openBrowser')}
        </Button>
      )}
      {waiting && state.prompt && (
        <div ref={prompt} className="settings-field">
          <Label htmlFor="provider-auth-answer">{state.prompt.message}</Label>
          {state.prompt.type === 'select' ? (
            <Select value={answer} onValueChange={setAnswer}>
              <SelectTrigger id="provider-auth-answer">
                <SelectValue placeholder={t('login.chooseOption')} />
              </SelectTrigger>
              <SelectContent position="popper" align="start" collisionPadding={8}>
                {state.prompt.options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="provider-auth-answer"
              type={state.prompt.type === 'secret' ? 'password' : 'text'}
              value={answer}
              autoComplete="off"
              onChange={(event) => setAnswer(event.target.value)}
            />
          )}
          <Button
            disabled={state.prompt.type === 'select' && !answer}
            onClick={() => void action(() => bridge!.answer(state.id, state.prompt!.id, answer))}
          >
            {t('login.continue')}
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        {waiting ? (
          <Button variant="outline" onClick={() => void action(() => bridge!.cancel(state.id))}>
            {t('login.cancel')}
          </Button>
        ) : (
          <Button
            disabled={disabled || !bridge}
            onClick={() =>
              void action(async () => {
                const next = await bridge!.login(connectionId);
                if (!active.current) {
                  await bridge!.cancel(next.id);
                  return;
                }
                if (current.current?.id !== next.id) current.current = next;
                setState(current.current);
              })
            }
          >
            {state?.status === 'error' ? t('login.tryAgain') : t('login.signIn')}
          </Button>
        )}
      </div>
    </div>
  );
}
