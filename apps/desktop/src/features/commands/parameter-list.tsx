import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import type { Parameter } from '../../client/agent/command-schema';
import { IconButton } from '../../components/icon-button';
import { SettingsGroup } from '../settings/settings-group';
import { parameterTypeTag } from './command-variables';
import { FieldError } from './field-error';
import { errorId } from './use-command-problems';

/**
 * The command editor's parameters: one row each, reordered and removed in place and edited on
 * their own page, which `onOpen` opens by the parameter's key (null adds a parameter).
 */
export function ParameterList({
  parameters,
  onChange,
  onOpen,
  error,
}: {
  parameters: readonly Parameter[];
  onChange: (parameters: Parameter[]) => void;
  onOpen: (key: string | null) => void;
  /** The parameters' problem in the app's language, or '' when there is none. */
  error: string;
}) {
  const { t } = useTranslation('commands');
  function move(index: number, offset: number) {
    const next = [...parameters];
    const item = next.splice(index, 1)[0]!;
    next.splice(index + offset, 0, item);
    onChange(next);
  }
  return (
    <SettingsGroup
      id="command-parameters"
      title={t('editor.parameters')}
      description={t('editor.parametersHint')}
      action={
        <Button variant="outline" disabled={parameters.length >= 20} onClick={() => onOpen(null)}>
          <Plus />
          {t('parameters.add')}
        </Button>
      }
    >
      {error && <FieldError id={errorId('parameters')}>{error}</FieldError>}
      <ul className="parameter-items">
        {parameters.map((item, index) => {
          const type = t(parameterTypeTag(item.type));
          const required = item.required ? ` · ${t('parameters.required')}` : '';
          return (
            <li key={item.key} className="parameter-item hover:bg-muted/50">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={item.label}>
                  {item.label}
                </p>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={`{{argument.${item.key}}} · ${type}${required}`}
                >
                  <span className="variable-token">{`{{argument.${item.key}}}`}</span> · {type}
                  {required}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  label={t('editor.moveUp')}
                  aria-label={t('editor.moveUpFor', { name: item.label })}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp />
                </IconButton>
                <IconButton
                  label={t('editor.moveDown')}
                  aria-label={t('editor.moveDownFor', { name: item.label })}
                  disabled={index === parameters.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown />
                </IconButton>
                <IconButton
                  label={t('common.edit')}
                  aria-label={t('editor.editFor', { name: item.label })}
                  onClick={() => onOpen(item.key)}
                >
                  <Pencil />
                </IconButton>
                <IconButton
                  label={t('common.remove')}
                  aria-label={t('editor.removeFor', { name: item.label })}
                  onClick={() => onChange(parameters.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
    </SettingsGroup>
  );
}
