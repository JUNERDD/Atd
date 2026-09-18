import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import { Switch } from '@ai/ui/components/switch';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import type { Parameter } from '../../../electron/agent/command-schema';
import { ParameterSchema } from '../../../electron/agent/command-schema';
import { parse } from '../../../electron/agent/validation';
import { parameterError } from '../../../electron/agent/command-validation';
import { SettingsHeading } from '../settings/settings-heading';
import { IconButton } from '../../components/icon-button';
import { FieldHint } from '../../components/field-hint';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { messageOf } from '../../lib/errors';
import { ParameterField } from './parameter-field';

export function ParameterEditor({
  initial,
  commandName,
  keys,
  onSave,
  onCancel,
}: {
  initial: Parameter | null;
  commandName: string;
  keys: string[];
  onSave: (parameter: Parameter) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('commands');
  const [draft, setDraft] = useState<Parameter>(
    initial ?? {
      type: 'text',
      key: '',
      label: '',
      description: '',
      required: false,
      multiline: false,
      maxLength: 120,
    },
  );
  const [error, setError] = useState('');
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const footerRef = useOverlayFooter<HTMLElement>();
  function changeType(type: string) {
    const base = {
      key: draft.key,
      label: draft.label,
      description: draft.description,
      required: draft.required,
    };
    if (type === 'text') setDraft({ ...base, type, multiline: false, maxLength: 120 });
    if (type === 'number') setDraft({ ...base, type });
    if (type === 'boolean') setDraft({ ...base, type, default: false });
    if (type === 'enum') setDraft({ ...base, type, options: [{ label: '', value: '' }] });
  }
  function save() {
    try {
      const parameter = parse(ParameterSchema, draft);
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(parameter.key)) throw new Error(t('parameters.errorKey'));
      if (!parameter.label.trim()) throw new Error(t('parameters.errorLabel'));
      if (keys.includes(parameter.key)) throw new Error(t('parameters.errorDuplicateKey'));
      if (
        parameter.type === 'number' &&
        parameter.min !== undefined &&
        parameter.max !== undefined &&
        parameter.min > parameter.max
      )
        throw new Error(t('parameters.errorRange'));
      if (
        parameter.type === 'enum' &&
        (parameter.options.some((option) => !option.label.trim() || !option.value.trim()) ||
          new Set(parameter.options.map((option) => option.value)).size !==
            parameter.options.length)
      )
        throw new Error(t('parameters.errorOptions'));
      const validation =
        parameter.default === undefined ? '' : parameterError(parameter, parameter.default);
      if (validation) throw new Error(validation);
      onSave(parameter);
    } catch (error) {
      setError(messageOf(error));
      requestAnimationFrame(() => errorMessage.current?.scrollIntoView({ block: 'nearest' }));
    }
  }
  const variable = `{{argument.${draft.key || 'key'}}}`;
  return (
    <section className="command-editor" data-figma-node="440:6805">
      <SettingsHeading
        title={initial ? t('parameters.editTitle') : t('parameters.newTitle')}
        description={t('parameters.subtitle', { name: commandName || t('editor.newTitle') })}
        onBack={onCancel}
        backLabel={t('parameters.back')}
      />
      <ScrollArea
        className="flex-1 min-h-0 min-w-0 m-[-3px_-15px_-3px_-3px]"
        viewportClassName="overlay-footer-fade"
        gutter
      >
        <div className="editor-fields p-0.75">
          <div className="field-columns aligned-fields">
            <div className="settings-field">
              <Label htmlFor="parameter-label">{t('parameters.label')}</Label>
              <Input
                id="parameter-label"
                value={draft.label}
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              />
            </div>
            <div className="settings-field">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="parameter-key">{t('parameters.key')}</Label>
                <FieldHint text={t('parameters.keyHint')} />
              </div>
              <Input
                id="parameter-key"
                value={draft.key}
                onChange={(event) => setDraft({ ...draft, key: event.target.value })}
              />
            </div>
          </div>
          <div className="settings-field">
            <Label htmlFor="parameter-type">{t('parameters.type.label')}</Label>
            <Select value={draft.type} onValueChange={changeType}>
              <SelectTrigger id="parameter-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">{t('parameters.type.option.text')}</SelectItem>
                <SelectItem value="number">{t('parameters.type.option.number')}</SelectItem>
                <SelectItem value="enum">{t('parameters.type.option.enum')}</SelectItem>
                <SelectItem value="boolean">{t('parameters.type.option.boolean')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="settings-field">
            <Label htmlFor="parameter-description">{t('parameters.description')}</Label>
            <Input
              id="parameter-description"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </div>
          {draft.type === 'text' && (
            <div className="field-columns aligned-fields">
              <div className="settings-field">
                <Label>{t('parameters.textStyle')}</Label>
                <Select
                  value={draft.multiline ? 'multi' : 'single'}
                  onValueChange={(value) => setDraft({ ...draft, multiline: value === 'multi' })}
                >
                  <SelectTrigger aria-label={t('parameters.textStyle')} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">{t('parameters.singleLine')}</SelectItem>
                    <SelectItem value="multi">{t('parameters.multipleLines')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="settings-field">
                <Label htmlFor="parameter-length">{t('parameters.maxLength')}</Label>
                <Input
                  id="parameter-length"
                  type="number"
                  min={1}
                  max={10000}
                  value={Number.isFinite(draft.maxLength) ? draft.maxLength : ''}
                  onChange={(event) =>
                    setDraft({ ...draft, maxLength: event.target.valueAsNumber })
                  }
                />
              </div>
            </div>
          )}
          {draft.type === 'number' && (
            <div className="field-columns aligned-fields">
              {(['min', 'max'] as const).map((field) => (
                <div className="settings-field" key={field}>
                  <Label htmlFor={`parameter-${field}`}>
                    {field === 'min' ? t('parameters.minimum') : t('parameters.maximum')}
                  </Label>
                  <Input
                    id={`parameter-${field}`}
                    type="number"
                    step="any"
                    value={draft[field] ?? ''}
                    onChange={(event) => {
                      const next = { ...draft };
                      if (!event.target.value) delete next[field];
                      else next[field] = event.target.valueAsNumber;
                      setDraft(next);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          {draft.type === 'enum' && (
            <section className="settings-field">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Label>{t('parameters.options')}</Label>
                  <FieldHint text={t('parameters.optionsHint')} />
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    setDraft({ ...draft, options: [...draft.options, { value: '', label: '' }] })
                  }
                >
                  <Plus />
                  {t('parameters.addOption')}
                </Button>
              </div>
              {draft.options.map((option, index) => (
                <div className="option-row" key={index}>
                  <div className="field-columns aligned-fields">
                    <div className="settings-field">
                      <Label htmlFor={`option-label-${index}`}>{t('parameters.label')}</Label>
                      <Input
                        id={`option-label-${index}`}
                        value={option.label}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            options: draft.options.map((item, i) =>
                              i === index ? { ...item, label: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </div>
                    <div className="settings-field">
                      <Label htmlFor={`option-value-${index}`}>{t('parameters.value')}</Label>
                      <Input
                        id={`option-value-${index}`}
                        value={option.value}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            options: draft.options.map((item, i) =>
                              i === index ? { ...item, value: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="option-action">
                    <IconButton
                      label={t('common.remove')}
                      aria-label={t('parameters.removeOption', { index: index + 1 })}
                      disabled={draft.options.length === 1}
                      onClick={() =>
                        setDraft({ ...draft, options: draft.options.filter((_, i) => i !== index) })
                      }
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                </div>
              ))}
            </section>
          )}
          <ParameterField
            parameter={{
              ...draft,
              label: t('parameters.defaultValue'),
              required: false,
              description: '',
            }}
            value={draft.default}
            onChange={(value) => {
              const next = { ...draft };
              if (value === undefined || value === '') delete next.default;
              else if (
                (draft.type === 'text' || draft.type === 'enum') &&
                typeof value === 'string'
              )
                return setDraft({ ...draft, default: value });
              else if (draft.type === 'number' && typeof value === 'number')
                return setDraft({ ...draft, default: value });
              else if (draft.type === 'boolean' && typeof value === 'boolean')
                return setDraft({ ...draft, default: value });
              setDraft(next);
            }}
          />
          <div className="flex items-center justify-between">
            <Label htmlFor="parameter-required">{t('parameters.required')}</Label>
            <Switch
              id="parameter-required"
              checked={draft.required}
              onCheckedChange={(required) => setDraft({ ...draft, required })}
            />
          </div>
          <p
            className="truncate text-sm text-muted-foreground"
            title={`${t('parameters.availablePrefix')}${variable}${t('parameters.availableSuffix')}`}
          >
            {t('parameters.availablePrefix')}
            <span className="variable-token">{variable}</span>
            {t('parameters.availableSuffix')}
          </p>
          {error && (
            <p ref={errorMessage} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </ScrollArea>
      <footer ref={footerRef} className="editor-footer overlay-footer">
        <span className="text-xs text-muted-foreground">{t('parameters.footerHint')}</span>
        <div>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save}>{initial ? t('parameters.save') : t('parameters.add')}</Button>
        </div>
      </footer>
    </section>
  );
}
