import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@atd/ui/components/collapsible';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import type { LoginState } from '../../client/providers/schema';
import { showErrorToast } from '../../components/toast-store';
import { ChatGPTLoginComplete } from './chatgpt-settings';

export function ProviderSignIn({
  state,
  disabled,
}: {
  state: LoginState | null;
  disabled: boolean;
}) {
  const { t } = useTranslation('providers');
  const bridge = window.desktop?.settings.providers;
  const [response, setResponse] = useState({ promptId: '', value: '' });
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const promptId = state?.prompt?.id ?? '';
  const answer = response.promptId === promptId ? response.value : '';
  const setAnswer = (value: string) => setResponse({ promptId, value });
  const prompt = useRef<HTMLDivElement>(null);
  const feedback = useRef<HTMLOutputElement>(null);
  async function action(operation: () => Promise<unknown>) {
    try {
      await operation();
    } catch (error) {
      showErrorToast(error);
    }
  }
  const waiting = state?.status === 'waiting';
  useEffect(() => {
    if (waiting && (state?.prompt?.type !== 'manual_code' || fallbackOpen))
      prompt.current?.querySelector<HTMLElement>('input, [role="combobox"]')?.focus();
  }, [state?.prompt?.id, state?.prompt?.type, waiting, fallbackOpen]);
  useEffect(() => {
    if (state?.status === 'error') feedback.current?.scrollIntoView({ block: 'nearest' });
  }, [state?.status]);
  return (
    <div className="provider-sign-in settings-field">
      {state?.status === 'complete' && state.chatgptPlanEnabled !== undefined ? (
        <ChatGPTLoginComplete planEnabled={state.chatgptPlanEnabled} />
      ) : (
        state && (
          <output
            ref={feedback}
            role={state.status === 'error' ? 'alert' : 'status'}
            className={state.status === 'error' ? 'text-destructive' : undefined}
          >
            {state.diagnostic ? t(`login.errors.${state.diagnostic.kind}`) : state.message}
          </output>
        )
      )}
      {state?.status === 'error' && state.diagnostic && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button size="xs" variant="ghost">
              {t('login.errorDetails')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="text-xs text-muted-foreground">
            <p>{t(`login.stages.${state.diagnostic.stage}`)}</p>
            {state.diagnostic.reason && <p>{t(`login.reasons.${state.diagnostic.reason}`)}</p>}
            <code className="wrap-anywhere select-all">
              {[
                state.diagnostic.code,
                state.diagnostic.field,
                state.diagnostic.status && `HTTP ${state.diagnostic.status}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </code>
            {state.diagnostic.requestId && (
              <p className="wrap-anywhere select-all">
                {t('login.requestId', { id: state.diagnostic.requestId })}
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
      {waiting && state.code && (
        <code className="text-lg tracking-widest select-all">{state.code}</code>
      )}
      {waiting && state.url && (
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => void action(() => bridge!.openLink(state.id))}
        >
          {t('login.openBrowser')}
        </Button>
      )}
      {waiting && state.prompt && (
        <Collapsible
          open={state.prompt.type !== 'manual_code' || fallbackOpen}
          onOpenChange={setFallbackOpen}
        >
          {state.prompt.type === 'manual_code' && (
            <CollapsibleTrigger asChild>
              <Button size="xs" variant="ghost">
                {t('login.manualFallback')}
              </Button>
            </CollapsibleTrigger>
          )}
          <CollapsibleContent>
            <div ref={prompt} className="settings-field">
              <Label htmlFor="provider-auth-answer">{state.prompt.message}</Label>
              {state.prompt.type === 'select' ? (
                <Select value={answer} onValueChange={setAnswer} disabled={disabled}>
                  <SelectTrigger id="provider-auth-answer">
                    <SelectValue placeholder={t('login.chooseOption')} />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start" collisionPadding={8}>
                    <SelectGroup>
                      {state.prompt.options.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="provider-auth-answer"
                  type={state.prompt.type === 'secret' ? 'password' : 'text'}
                  value={answer}
                  disabled={disabled}
                  autoComplete="off"
                  onChange={(event) => setAnswer(event.target.value)}
                />
              )}
              <Button
                disabled={disabled || !answer.trim()}
                onClick={() =>
                  void action(() => bridge!.answer(state.id, state.prompt!.id, answer))
                }
              >
                {t('login.continue')}
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
