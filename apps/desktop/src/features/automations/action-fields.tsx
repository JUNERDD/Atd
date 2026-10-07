import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Command, MessageSquareText } from 'lucide-react';
import type { AutomationAction, AutomationTrigger } from '@atd/agent-contracts';
import { Label } from '@atd/ui/components/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@atd/ui/components/tabs';
import { Textarea } from '@atd/ui/components/textarea';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { FieldError } from '../commands/field-error';
import { defaultAction, type ActionKind, type DraftPatch } from './automation-draft';
import { SettingsGroup } from '../settings/settings-group';
import { CommandActionFields } from './command-action-fields';
import { errorId, type AutomationProblemsView } from './use-automation-problems';

const ACTION_KINDS: readonly ActionKind[] = ['prompt', 'command', 'consolidateMemory'];

function ActionIcon({ kind }: { kind: ActionKind }) {
  switch (kind) {
    case 'prompt':
      return <MessageSquareText aria-hidden="true" />;
    case 'command':
      return <Command aria-hidden="true" />;
    case 'consolidateMemory':
      return <Brain aria-hidden="true" />;
  }
}

/**
 * "What it does": a prompt written for the automation, a saved command with its parameter values
 * and input, or consolidating memory, as tabs. Switching keeps what the other kinds held.
 * Consolidation is the memory engine's own job: it has nothing to fill in and starts no task, so
 * its tab says what it changes instead.
 */
export function ActionFields({
  action,
  trigger,
  onChange,
  patch,
  commands,
  problems,
}: {
  action: AutomationAction;
  trigger: AutomationTrigger;
  onChange: (action: AutomationAction) => void;
  /** For choosing a command, which also sets the policy's memory. */
  patch: DraftPatch;
  commands: readonly CommandDefinition[];
  problems: AutomationProblemsView;
}) {
  const { t } = useTranslation('automations');
  const [kept, setKept] = useState<Partial<Record<ActionKind, AutomationAction>>>({});
  const promptError = problems.text('prompt');
  function switchKind(value: string) {
    const kind = ACTION_KINDS.find((item) => item === value);
    if (!kind || kind === action.kind) return;
    setKept((current) => ({ ...current, [action.kind]: action }));
    onChange(kept[kind] ?? defaultAction(kind));
  }
  return (
    <SettingsGroup
      id="automation-action"
      title={t('action.title')}
      description={
        action.kind === 'consolidateMemory'
          ? t('action.descriptionMemory')
          : t('action.description')
      }
    >
      <Tabs value={action.kind} onValueChange={switchKind}>
        <TabsList
          aria-label={t('action.kindLabel')}
          className="max-w-full justify-start overflow-x-auto overflow-y-hidden"
        >
          {ACTION_KINDS.map((kind) => (
            <TabsTrigger key={kind} value={kind} className="flex-none px-2.5">
              <ActionIcon kind={kind} />
              {t(`action.kinds.${kind}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={action.kind} className="automation-tab-panel">
          {action.kind === 'prompt' ? (
            <div className="settings-field">
              <Label htmlFor="automation-prompt" className="sr-only">
                {t('action.prompt')}
              </Label>
              <Textarea
                id="automation-prompt"
                value={action.prompt}
                maxLength={20000}
                rows={6}
                placeholder={t('action.promptPlaceholder')}
                className="automation-prompt"
                aria-invalid={Boolean(promptError) || undefined}
                aria-describedby={promptError ? errorId('prompt') : 'automation-prompt-note'}
                onChange={(event) => onChange({ ...action, prompt: event.target.value })}
              />
              {promptError ? (
                <FieldError id={errorId('prompt')}>{promptError}</FieldError>
              ) : (
                <p id="automation-prompt-note" className="settings-field-note">
                  {t('action.promptNote')}
                </p>
              )}
            </div>
          ) : action.kind === 'consolidateMemory' ? (
            <p className="settings-field-note">{t('action.consolidateNote')}</p>
          ) : (
            <CommandActionFields
              action={action}
              trigger={trigger}
              onChange={onChange}
              patch={patch}
              commands={commands}
              problems={problems}
            />
          )}
        </TabsContent>
      </Tabs>
    </SettingsGroup>
  );
}
