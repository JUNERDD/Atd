import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  actsOnSelection,
  defaultCommandOutput,
  readsSelection,
  writesBack,
} from '@atd/agent-contracts';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { SettingsGroup } from '../settings/settings-group';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { FieldError } from './field-error';
import { InputOptions } from './input-options';
import { OutputField } from './output-field';
import { withServableOutputs } from './shortcut-drafts';
import { errorId } from './use-command-problems';

const SOURCES = ['manual', 'selection', 'clipboard', 'screenshot', 'none'] as const;
type Source = (typeof SOURCES)[number];

const SOURCE_LABELS = {
  manual: 'input.sourceManual',
  selection: 'input.sourceSelection',
  clipboard: 'input.sourceClipboard',
  screenshot: 'input.sourceScreenshot',
  none: 'input.sourceNone',
} as const satisfies Record<Source, string>;

/**
 * What a run reads and where its answer goes, as one editor group: the input source beside the
 * result, then the input options, the review switch of a write-back, and notes on what the shell
 * does around the run. The result offers only the actions this input can serve: the ones on the
 * selection (`actsOnSelection`) need a command that reads it, so they are left out until it does,
 * and an input change that stops reading the selection returns such a result to the conversation.
 * A command that takes the selection, run from its shortcut with nothing selected, asks for the
 * text on the island and puts a selection write-back at the cursor (`withComposedInput`); an
 * answer the app cannot take shows in the island's answer card.
 */
export function InputResultSettings({
  command,
  onChange,
  optionsOpen,
  onOptionsOpenChange,
  error,
  onBlur,
}: {
  command: CommandDefinition;
  onChange: (command: CommandDefinition) => void;
  optionsOpen: boolean;
  onOptionsOpenChange: (open: boolean) => void;
  /** The input settings' problem in the app's language, or '' when there is none. */
  error: string;
  /** Focus left the input settings (the options popover included). */
  onBlur: () => void;
}) {
  const { t } = useTranslation('commands');
  const ids = useId();
  const { action, review } = command.output;
  const writeBack = writesBack(action);
  const notes = [
    command.input.source === 'selection' &&
      t(actsOnSelection(action) ? 'io.composeCursorNote' : 'io.composeNote'),
    writeBack && t('output.writeBackNote'),
    writeBack && t('output.cardNote'),
  ].filter((note) => typeof note === 'string');
  /**
   * Applies an input change. An output that acts on the selection needs a command that reads it,
   * so it returns to the conversation when the input stops reading the selection, and a
   * shortcut's such override returns to following the command.
   */
  function update(input: CommandDefinition['input'], placement = command.placement) {
    const strands = actsOnSelection(action) && !readsSelection(input);
    onChange({
      ...command,
      input,
      placement,
      output: strands ? defaultCommandOutput() : command.output,
      shortcuts: withServableOutputs(command.shortcuts, input),
    });
  }
  function source(value: string) {
    const next = SOURCES.find((candidate) => candidate === value);
    if (!next) return;
    // A source turns on what it fills (the screenshot is an attached image) and keeps it on.
    // Switching to Selected text also puts the command on the selection toolbar over other apps,
    // where a command that takes the selection as its input has always shown.
    const toToolbar = next === 'selection' && command.input.source !== 'selection';
    update(
      {
        ...command.input,
        source: next,
        required: next === 'none' ? false : command.input.required,
        files: command.input.files || next === 'screenshot',
        selection: command.input.selection || next === 'selection',
        clipboard: command.input.clipboard || next === 'clipboard',
      },
      toToolbar ? { ...command.placement, selectionToolbar: true } : command.placement,
    );
  }
  return (
    <SettingsGroup id="command-io" title={t('io.title')} description={t('io.description')}>
      <div className="space-y-4" onBlur={onBlur}>
        <div className="flex flex-col gap-2">
          <div className="field-columns aligned-fields">
            <div className="settings-field">
              <Label htmlFor="command-source">{t('input.source')}</Label>
              <Select value={command.input.source} onValueChange={source}>
                <SelectTrigger
                  id="command-source"
                  className="w-full"
                  aria-invalid={Boolean(error) || undefined}
                  aria-describedby={error ? errorId('input') : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {t(SOURCE_LABELS[candidate])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <OutputField
              id="command-result"
              input={command.input}
              value={action}
              describedBy={notes.length ? `${ids}-notes` : undefined}
              onChange={(next) => {
                if (next) onChange({ ...command, output: { ...command.output, action: next } });
              }}
            />
          </div>
          {error && <FieldError id={errorId('input')}>{error}</FieldError>}
        </div>
        <InputOptions
          input={command.input}
          onChange={(input) => update(input)}
          open={optionsOpen}
          onOpenChange={onOptionsOpenChange}
        />
      </div>
      {writeBack && (
        <Card size="sm" className="settings-card">
          <ItemGroup>
            <SettingsSwitchRow
              id="command-output-review"
              title={t('output.review.title')}
              description={t('output.review.description')}
              checked={review}
              onCheckedChange={(checked) =>
                onChange({ ...command, output: { ...command.output, review: checked } })
              }
            />
          </ItemGroup>
        </Card>
      )}
      {notes.length > 0 && (
        <div id={`${ids}-notes`} className="flex flex-col gap-1">
          {notes.map((note) => (
            <p key={note} className="settings-field-note">
              {note}
            </p>
          ))}
        </div>
      )}
    </SettingsGroup>
  );
}
