import { useTranslation } from 'react-i18next';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import { Textarea } from '@atd/ui/components/textarea';
import { FieldHint } from '../../components/field-hint';
import { FieldError } from '../commands/field-error';
import {
  MEMORY_LIMITS,
  withType,
  type MemoryCheckedField,
  type MemoryDraft,
  type MemoryDraftError,
} from './memory-draft';
import {
  MEMORY_ACTIVATION_ORDER,
  MEMORY_ACTIVATIONS,
  MEMORY_CATEGORIES,
  MEMORY_CATEGORY_ORDER,
  MEMORY_TYPE_ORDER,
  MEMORY_TYPES,
} from './memory-labels';

/** The Category field's value for no category; Select items cannot hold an empty value. */
const NO_CATEGORY = 'none';

const isOneOf = <T extends string>(options: readonly T[], value: string): value is T =>
  options.some((option) => option === value);

/**
 * The memory page's fields, composed like the command editor: Name beside Type, the Description,
 * How it's used beside Category (offered for the failure type only), then the content. `idPrefix`
 * ids each control as `${idPrefix}-${field}`, so the page can focus the first problem. Problems
 * show under their field once a save was tried and then follow the edits.
 */
export function MemoryFields({
  idPrefix,
  draft,
  errors,
  creating,
  onChange,
}: {
  idPrefix: string;
  draft: MemoryDraft;
  errors: Partial<Record<MemoryCheckedField, MemoryDraftError>>;
  /** The New memory page, where an empty name is named from the description. */
  creating: boolean;
  onChange: (next: MemoryDraft) => void;
}) {
  const { t } = useTranslation('memory');
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const errorId = (field: MemoryCheckedField) => `${idPrefix}-${field}-error`;
  const invalid = (field: MemoryCheckedField) => ({
    'aria-invalid': Boolean(errors[field]) || undefined,
    'aria-describedby': errors[field] ? errorId(field) : undefined,
  });
  const problem = (field: MemoryCheckedField) => {
    const error = errors[field];
    return error ? (
      <FieldError id={errorId(field)}>{t(`memory.errors.${error}`)}</FieldError>
    ) : null;
  };
  const activation = MEMORY_ACTIVATIONS[draft.activation];
  return (
    <>
      <div className="field-columns aligned-fields">
        <div className="settings-field">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={fieldId('name')}>{t('memory.page.name')}</Label>
            <FieldHint text={t('memory.page.nameHint')} />
          </div>
          <div className="settings-field">
            <Input
              id={fieldId('name')}
              value={draft.name}
              maxLength={MEMORY_LIMITS.name}
              placeholder={creating ? t('memory.page.namePlaceholder') : undefined}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              {...invalid('name')}
            />
            {problem('name')}
          </div>
        </div>
        <div className="settings-field">
          <Label htmlFor={fieldId('type')}>{t('memory.page.type')}</Label>
          <Select
            value={draft.type}
            onValueChange={(value) => {
              if (isOneOf(MEMORY_TYPE_ORDER, value)) onChange(withType(draft, value));
            }}
          >
            <SelectTrigger id={fieldId('type')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMORY_TYPE_ORDER.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(MEMORY_TYPES[type].labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="settings-field">
        <Label htmlFor={fieldId('description')}>{t('memory.page.description')}</Label>
        <Input
          id={fieldId('description')}
          value={draft.description}
          maxLength={MEMORY_LIMITS.description}
          placeholder={t('memory.page.descriptionPlaceholder')}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
          {...invalid('description')}
        />
        {problem('description')}
      </div>
      <div className="field-columns aligned-fields">
        <div className="settings-field">
          <Label htmlFor={fieldId('activation')}>{t('memory.page.activation')}</Label>
          <div className="settings-field">
            <Select
              value={draft.activation}
              onValueChange={(value) => {
                if (isOneOf(MEMORY_ACTIVATION_ORDER, value))
                  onChange({ ...draft, activation: value });
              }}
            >
              <SelectTrigger
                id={fieldId('activation')}
                className="w-full"
                aria-describedby={fieldId('activation-hint')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMORY_ACTIVATION_ORDER.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(MEMORY_ACTIVATIONS[value].labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id={fieldId('activation-hint')} className="settings-field-note">
              {t(activation.hintKey)}
            </p>
          </div>
        </div>
        {draft.type === 'failure' ? (
          <div className="settings-field">
            <Label htmlFor={fieldId('category')}>{t('memory.page.category')}</Label>
            <Select
              value={draft.category ?? NO_CATEGORY}
              onValueChange={(value) =>
                onChange({
                  ...draft,
                  category: isOneOf(MEMORY_CATEGORY_ORDER, value) ? value : null,
                })
              }
            >
              <SelectTrigger id={fieldId('category')} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>{t('memory.category.none')}</SelectItem>
                {MEMORY_CATEGORY_ORDER.map((category) => (
                  <SelectItem key={category} value={category}>
                    {t(MEMORY_CATEGORIES[category])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <div className="settings-field">
        <Label htmlFor={fieldId('body')}>{t('memory.page.body')}</Label>
        <Textarea
          id={fieldId('body')}
          rows={8}
          maxLength={MEMORY_LIMITS.body}
          value={draft.body}
          onChange={(event) => onChange({ ...draft, body: event.target.value })}
          {...invalid('body')}
        />
        {problem('body')}
        <p className="settings-field-note">{t('memory.page.bodyNote')}</p>
      </div>
    </>
  );
}
