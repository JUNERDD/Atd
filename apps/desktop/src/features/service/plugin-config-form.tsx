import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginConfigRequest, PluginDetail } from '@ai/agent-contracts';
import { Badge } from '@ai/ui/components/badge';
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
import { Switch } from '@ai/ui/components/switch';
import { showToast } from '../../components/toast-store';
import { ExtensionDetailSection } from './extension-detail-fields';
import type { PluginResult } from './use-plugin-mutations';

type ConfigOption = PluginDetail['userConfig'][number];
type Draft = Record<string, string | boolean>;
type Values = PluginConfigRequest['values'];

/** Text fields hold what is typed; switches their state; a secret field only a new value. */
function initialDraft(detail: PluginDetail): Draft {
  return Object.fromEntries(
    detail.userConfig.map((option) => {
      const value = detail.config[option.key]?.value ?? option.default;
      if (option.type === 'boolean') return [option.key, value === true];
      return [option.key, option.sensitive || value === undefined ? '' : String(value)];
    }),
  );
}

/**
 * The values a plugin asks for (Claude `userConfig`): text, number, folder or file fields, a list
 * of choices, or a switch. A secret is never shown: its field says whether one is set, takes a new
 * value, or clears it on save. Required values are checked here first; the service's answer to a
 * save replaces the page's detail, and its error stays under the form.
 */
export function PluginConfigForm({
  detail,
  disabled,
  focus,
  onSave,
}: {
  detail: PluginDetail;
  disabled: boolean;
  /** Scrolls the form into view when the page opens, as More › Configure asks. */
  focus: boolean;
  onSave: (values: Values) => Promise<PluginResult<PluginDetail>>;
}) {
  const { t } = useTranslation('settings');
  const formId = useId();
  const sectionRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(() => initialDraft(detail));
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  useEffect(() => {
    if (focus) sectionRef.current?.scrollIntoView({ block: 'start' });
  }, [focus]);

  function collect(): { values: Values; errors: Record<string, string> } {
    const values: Values = {};
    const found: Record<string, string> = {};
    for (const option of detail.userConfig) {
      const raw = draft[option.key];
      const isSet = detail.config[option.key]?.set === true;
      if (typeof raw === 'boolean') {
        values[option.key] = raw;
        continue;
      }
      const text = (raw ?? '').trim();
      if (option.sensitive && cleared.has(option.key)) {
        if (option.required) found[option.key] = t('extensions.plugins.config.required');
        else values[option.key] = null;
        continue;
      }
      if (!text) {
        // An untouched secret keeps its stored value.
        if (option.required && !(option.sensitive && isSet))
          found[option.key] = t('extensions.plugins.config.required');
        else if (!option.sensitive) values[option.key] = null;
        continue;
      }
      if (option.type !== 'number') {
        values[option.key] = text;
        continue;
      }
      const number = Number(text);
      const outside =
        (option.min !== undefined && number < option.min) ||
        (option.max !== undefined && number > option.max);
      if (!Number.isFinite(number) || outside)
        found[option.key] = t('extensions.plugins.config.invalidNumber');
      else values[option.key] = number;
    }
    return { values, errors: found };
  }

  function submit() {
    const { values, errors: found } = collect();
    setErrors(found);
    setFormError('');
    const first = detail.userConfig.find((option) => found[option.key]);
    if (first) {
      document.getElementById(`${formId}-${first.key}`)?.focus();
      return;
    }
    void onSave(values).then((result) => {
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setDraft(initialDraft(result.value));
      setCleared(new Set());
      showToast({ kind: 'info', text: t('extensions.plugins.config.saved') });
    });
  }

  const control = (option: ConfigOption, id: string, invalid: boolean) => {
    const value = draft[option.key];
    if (typeof value === 'boolean')
      return (
        <Switch
          id={id}
          checked={value}
          disabled={disabled}
          onCheckedChange={(next) => setDraft({ ...draft, [option.key]: next })}
        />
      );
    if (option.options?.length)
      return (
        <Select
          value={value || undefined}
          disabled={disabled}
          onValueChange={(next) => setDraft({ ...draft, [option.key]: next })}
        >
          <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
            <SelectValue placeholder={t('extensions.plugins.config.choose')} />
          </SelectTrigger>
          <SelectContent>
            {option.options.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {choice}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    const isSet = detail.config[option.key]?.set === true;
    return (
      <Input
        id={id}
        type={option.sensitive ? 'password' : option.type === 'number' ? 'number' : 'text'}
        inputMode={option.type === 'number' ? 'decimal' : undefined}
        value={value ?? ''}
        disabled={disabled || cleared.has(option.key)}
        autoComplete="off"
        spellCheck={false}
        placeholder={
          option.sensitive && isSet ? t('extensions.plugins.config.replaceSecret') : undefined
        }
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => setDraft({ ...draft, [option.key]: event.target.value })}
      />
    );
  };

  return (
    <div ref={sectionRef}>
      <ExtensionDetailSection label={t('extensions.plugins.config.title')}>
        <form
          id={formId}
          className="editor-fields"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled) submit();
          }}
        >
          <div className="field-columns">
            {detail.userConfig.map((option) => {
              const id = `${formId}-${option.key}`;
              const error = errors[option.key];
              const isSet = detail.config[option.key]?.set === true;
              const isCleared = cleared.has(option.key);
              return (
                <div key={option.key} className="settings-field">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Label htmlFor={id}>{option.title || option.key}</Label>
                    {option.required ? (
                      <span className="text-xs text-muted-foreground">
                        {t('extensions.plugins.config.requiredLabel')}
                      </span>
                    ) : null}
                    {option.sensitive ? (
                      <Badge variant="outline">
                        {isSet && !isCleared
                          ? t('extensions.plugins.config.set')
                          : t('extensions.plugins.config.unset')}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0 flex-1">{control(option, id, Boolean(error))}</div>
                    {option.sensitive && isSet ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => {
                          const next = new Set(cleared);
                          if (isCleared) next.delete(option.key);
                          else next.add(option.key);
                          setCleared(next);
                          setDraft({ ...draft, [option.key]: '' });
                        }}
                      >
                        {isCleared
                          ? t('extensions.plugins.config.keep')
                          : t('extensions.plugins.config.clear')}
                      </Button>
                    ) : null}
                  </div>
                  {option.description ? (
                    <p className="settings-field-note">{option.description}</p>
                  ) : null}
                  {error ? (
                    <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
                      {error}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {formError ? (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={disabled}>
              {t('extensions.plugins.config.save')}
            </Button>
          </div>
        </form>
      </ExtensionDetailSection>
    </div>
  );
}
