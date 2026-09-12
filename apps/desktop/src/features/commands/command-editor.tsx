import { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import { CommandSchema, type CommandDefinition } from '../../../electron/agent/command-schema';
import { renameArgument, validateCommand } from '../../../electron/agent/command-validation';
import { parse } from '../../../electron/agent/validation';
import type { ProviderSettings } from '../../../electron/settings-contract';
import { IconButton } from '../../components/icon-button';
import { agentApi, messageOf } from '../agent/use-agent';
import { InputOptions } from './input-options';
import { InstructionEditor } from './instruction-editor';
import { ParameterEditor } from './parameter-editor';
import { CommandPreview } from './command-preview';
import { RunSettings } from './run-settings';

export function CommandEditor({
  initial,
  expectedRevision,
  connectionId,
  provider,
  onSaved,
  onCancel,
}: {
  initial: CommandDefinition;
  expectedRevision: number;
  connectionId: string;
  provider: ProviderSettings | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [baseRevision, setBaseRevision] = useState(expectedRevision);
  const [parameter, setParameter] = useState<{ index: number | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setError('');
    try {
      validateCommand(draft);
      parse(CommandSchema, draft);
      setPending(true);
      await agentApi().saveCommand(draft, baseRevision);
      onSaved();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(false);
    }
  }
  async function reload() {
    try {
      const current = (await agentApi().get()).commands.find((command) => command.id === draft.id);
      if (!current)
        throw new Error(
          'This command was deleted. Cancel and create a new command to keep a copy.',
        );
      setDraft(current);
      setBaseRevision(current.revision);
      setError('');
    } catch (error) {
      setError(messageOf(error));
    }
  }
  function move(index: number, offset: number) {
    const parameters = [...draft.parameters];
    const item = parameters.splice(index, 1)[0]!;
    parameters.splice(index + offset, 0, item);
    setDraft({ ...draft, parameters });
  }
  if (parameter)
    return (
      <ParameterEditor
        initial={parameter.index === null ? null : draft.parameters[parameter.index]!}
        commandName={draft.name}
        keys={draft.parameters
          .filter((_, index) => index !== parameter.index)
          .map((item) => item.key)}
        onCancel={() => setParameter(null)}
        onSave={(value) => {
          const parameters = [...draft.parameters];
          const previousKey = parameter.index === null ? null : parameters[parameter.index]!.key;
          if (parameter.index === null) parameters.push(value);
          else parameters[parameter.index] = value;
          setDraft({
            ...draft,
            parameters,
            instructions:
              previousKey && previousKey !== value.key
                ? renameArgument(draft.instructions, previousKey, value.key)
                : draft.instructions,
          });
          setParameter(null);
        }}
      />
    );
  return (
    <section className="command-editor" aria-label="Command editor" data-figma-node="348:799">
      <header className="editor-heading">
        <IconButton label="Back to commands" onClick={onCancel}>
          <ArrowLeft />
        </IconButton>
        <h2>{baseRevision ? 'Edit command' : 'New command'}</h2>
      </header>
      <div className="editor-fields">
        <div className="field-columns">
          <div className="settings-field">
            <Label htmlFor="command-name">Name</Label>
            <Input
              id="command-name"
              value={draft.name}
              maxLength={120}
              placeholder="e.g. Weekly planning brief"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="settings-field">
            <Label htmlFor="command-description">Description</Label>
            <Input
              id="command-description"
              value={draft.description}
              maxLength={500}
              placeholder="What does this command do?"
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </div>
        </div>
        <InstructionEditor
          command={draft}
          onChange={setDraft}
          onAddParameter={() => setParameter({ index: null })}
          onConfigureSource={(source) => {
            const control = document.getElementById(
              source === 'input' ? 'command-source' : `input-${source}`,
            );
            const options = control?.closest('details');
            if (options) options.open = true;
            control?.scrollIntoView({ block: 'nearest' });
            control?.focus();
          }}
        />
        <InputOptions command={draft} onChange={setDraft} />
        <section className="settings-field">
          <div className="flex items-center justify-between">
            <Label>Parameters</Label>
            <Button
              variant="outline"
              disabled={draft.parameters.length >= 20}
              onClick={() => setParameter({ index: null })}
            >
              <Plus />
              Add parameter
            </Button>
          </div>
          {!draft.parameters.length && (
            <p className="text-xs text-muted-foreground">
              Add reusable fields to this command’s input form.
            </p>
          )}
          <ul className="parameter-items">
            {draft.parameters.map((item, index) => (
              <li key={item.key} className="parameter-item hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="variable-token">{`{{argument.${item.key}}}`}</span> ·{' '}
                    {item.type}
                    {item.required ? ' · Required' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton
                    label={`Move ${item.label} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp />
                  </IconButton>
                  <IconButton
                    label={`Move ${item.label} down`}
                    disabled={index === draft.parameters.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown />
                  </IconButton>
                  <IconButton label={`Edit ${item.label}`} onClick={() => setParameter({ index })}>
                    <Pencil />
                  </IconButton>
                  <IconButton
                    label={`Remove ${item.label}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        parameters: draft.parameters.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <Trash2 />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <RunSettings
          command={draft}
          onChange={setDraft}
          connectionId={connectionId}
          provider={provider}
        />
        {error && (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-destructive">{error}</p>
            {baseRevision > 0 && (
              <Button variant="outline" onClick={() => void reload()}>
                Reload latest version
              </Button>
            )}
          </div>
        )}
      </div>
      <footer className="editor-footer">
        <CommandPreview
          command={draft}
          save={async () => {
            const saved = await agentApi().saveCommand(draft, baseRevision);
            setDraft(saved);
            setBaseRevision(saved.revision);
            return saved;
          }}
        />
        <div>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => void save()}>
            {pending ? 'Saving…' : baseRevision ? 'Save changes' : 'Create command'}
          </Button>
        </div>
      </footer>
    </section>
  );
}
