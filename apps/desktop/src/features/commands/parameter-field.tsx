import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@ai/ui/components/input';
import { Textarea } from '@ai/ui/components/textarea';
import { Switch } from '@ai/ui/components/switch';
import { Label } from '@ai/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import type { Parameter } from '../../../electron/agent/command-schema';
import { parameterError } from '../../../electron/agent/command-validation';

export function ParameterField({
  parameter,
  value,
  onChange,
  validate = false,
}: {
  parameter: Parameter;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean | undefined) => void;
  validate?: boolean;
}) {
  const { t } = useTranslation('commands');
  const id = useId();
  const error = validate ? parameterError(parameter, value) : '';
  const label = (
    <Label htmlFor={id} className="min-w-0">
      <span className="truncate" title={parameter.label}>
        {parameter.label}
      </span>
      {parameter.required && <span className="text-muted-foreground"> *</span>}
    </Label>
  );
  return (
    <div className="settings-field parameter-field" data-figma-node="410:1982">
      {parameter.type === 'boolean' ? (
        <div className="flex items-center justify-between gap-3">
          {label}
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={onChange}
            aria-invalid={Boolean(error)}
          />
        </div>
      ) : (
        <>
          {label}
          {parameter.type === 'enum' ? (
            <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
              <SelectTrigger id={id} className="w-full" aria-invalid={Boolean(error)}>
                <SelectValue placeholder={t('parameters.chooseOption')} />
              </SelectTrigger>
              <SelectContent>
                {parameter.options
                  .filter((option) => option.value.trim())
                  .map((option, index) => (
                    <SelectItem key={`${index}:${option.value}`} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : parameter.type === 'number' ? (
            <Input
              id={id}
              type="number"
              value={typeof value === 'number' ? value : ''}
              min={parameter.min}
              max={parameter.max}
              step="any"
              aria-invalid={Boolean(error)}
              onChange={(event) =>
                onChange(event.target.value === '' ? undefined : event.target.valueAsNumber)
              }
            />
          ) : parameter.multiline ? (
            <Textarea
              id={id}
              value={typeof value === 'string' ? value : ''}
              maxLength={parameter.maxLength}
              aria-invalid={Boolean(error)}
              onChange={(event) => onChange(event.target.value)}
            />
          ) : (
            <Input
              id={id}
              value={typeof value === 'string' ? value : ''}
              maxLength={parameter.maxLength}
              aria-invalid={Boolean(error)}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </>
      )}
      {(error || parameter.description) && (
        <p
          className={error ? 'text-destructive text-xs' : 'truncate text-muted-foreground text-xs'}
          role={error ? 'alert' : undefined}
          title={error ? undefined : parameter.description}
        >
          {error || parameter.description}
        </p>
      )}
    </div>
  );
}
