import { useState } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import { Switch } from '@ai/ui/components/switch';
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
import { IconButton } from '../../components/icon-button';
import { messageOf } from '../agent/use-agent';
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
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(parameter.key))
        throw new Error('Use letters, numbers, and underscores; start with a letter.');
      if (!parameter.label.trim()) throw new Error('Enter a label.');
      if (keys.includes(parameter.key)) throw new Error('This variable key is already used.');
      if (
        parameter.type === 'number' &&
        parameter.min !== undefined &&
        parameter.max !== undefined &&
        parameter.min > parameter.max
      )
        throw new Error('Minimum must not exceed maximum.');
      if (
        parameter.type === 'enum' &&
        (parameter.options.some((option) => !option.label.trim() || !option.value.trim()) ||
          new Set(parameter.options.map((option) => option.value)).size !==
            parameter.options.length)
      )
        throw new Error('Every option needs a label and a unique value.');
      const validation =
        parameter.default === undefined ? '' : parameterError(parameter, parameter.default);
      if (validation) throw new Error(validation);
      onSave(parameter);
    } catch (error) {
      setError(messageOf(error));
    }
  }
  return (
    <section className="command-editor" data-figma-node="440:6805">
      <header className="editor-heading">
        <IconButton label="Back to command" onClick={onCancel}>
          <ArrowLeft />
        </IconButton>
        <h2>{initial ? 'Edit parameter' : 'New parameter'}</h2>
      </header>
      <p className="text-xs text-muted-foreground">{commandName || 'New command'} · Parameters</p>
      <div className="editor-fields">
        <div className="field-columns">
          <div className="settings-field">
            <Label htmlFor="parameter-label">Label</Label>
            <Input
              id="parameter-label"
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
          </div>
          <div className="settings-field">
            <Label htmlFor="parameter-key">Variable key</Label>
            <Input
              id="parameter-key"
              value={draft.key}
              onChange={(event) => setDraft({ ...draft, key: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">Used by saved inputs and instructions.</p>
          </div>
        </div>
        <div className="settings-field">
          <Label htmlFor="parameter-type">Type</Label>
          <Select value={draft.type} onValueChange={changeType}>
            <SelectTrigger id="parameter-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="number">Number</SelectItem>
              <SelectItem value="enum">Choice</SelectItem>
              <SelectItem value="boolean">Switch</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="settings-field">
          <Label htmlFor="parameter-description">Description</Label>
          <Input
            id="parameter-description"
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </div>
        {draft.type === 'text' && (
          <div className="field-columns">
            <div className="settings-field">
              <Label>Text style</Label>
              <Select
                value={draft.multiline ? 'multi' : 'single'}
                onValueChange={(value) => setDraft({ ...draft, multiline: value === 'multi' })}
              >
                <SelectTrigger aria-label="Text style" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single line</SelectItem>
                  <SelectItem value="multi">Multiple lines</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="settings-field">
              <Label htmlFor="parameter-length">Maximum length</Label>
              <Input
                id="parameter-length"
                type="number"
                min={1}
                max={10000}
                value={Number.isFinite(draft.maxLength) ? draft.maxLength : ''}
                onChange={(event) => setDraft({ ...draft, maxLength: event.target.valueAsNumber })}
              />
            </div>
          </div>
        )}
        {draft.type === 'number' && (
          <div className="field-columns">
            {(['min', 'max'] as const).map((field) => (
              <div className="settings-field" key={field}>
                <Label htmlFor={`parameter-${field}`}>
                  {field === 'min' ? 'Minimum' : 'Maximum'}
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
              <Label>Options</Label>
              <Button
                variant="outline"
                onClick={() =>
                  setDraft({ ...draft, options: [...draft.options, { value: '', label: '' }] })
                }
              >
                <Plus />
                Add option
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Keep values stable; labels can change without changing saved input.
            </p>
            {draft.options.map((option, index) => (
              <div className="option-row" key={index}>
                <div className="field-columns">
                  <div className="settings-field">
                    <Label htmlFor={`option-label-${index}`}>Label</Label>
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
                    <Label htmlFor={`option-value-${index}`}>Value</Label>
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
                <IconButton
                  label={`Remove option ${index + 1}`}
                  disabled={draft.options.length === 1}
                  onClick={() =>
                    setDraft({ ...draft, options: draft.options.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 />
                </IconButton>
              </div>
            ))}
          </section>
        )}
        <ParameterField
          parameter={{ ...draft, label: 'Default value', required: false, description: '' }}
          value={draft.default}
          onChange={(value) => {
            const next = { ...draft };
            if (value === undefined || value === '') delete next.default;
            else if ((draft.type === 'text' || draft.type === 'enum') && typeof value === 'string')
              return setDraft({ ...draft, default: value });
            else if (draft.type === 'number' && typeof value === 'number')
              return setDraft({ ...draft, default: value });
            else if (draft.type === 'boolean' && typeof value === 'boolean')
              return setDraft({ ...draft, default: value });
            setDraft(next);
          }}
        />
        <div className="flex items-center justify-between">
          <Label htmlFor="parameter-required">Required</Label>
          <Switch
            id="parameter-required"
            checked={draft.required}
            onCheckedChange={(required) => setDraft({ ...draft, required })}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Available in instructions as{' '}
          <span className="variable-token">{`{{argument.${draft.key || 'key'}}}`}</span>.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <footer className="editor-footer">
        <span className="text-xs text-muted-foreground">Updates this command’s input form</span>
        <div>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={save}>{initial ? 'Save parameter' : 'Add parameter'}</Button>
        </div>
      </footer>
    </section>
  );
}
