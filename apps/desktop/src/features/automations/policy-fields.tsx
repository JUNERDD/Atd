import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  commandThinkingLevel,
  type AutomationDraft,
  type AutomationMissedRuns,
  type AutomationPolicy,
  type ModelAlias,
} from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import type { CommandDefinition } from '../../client/agent/command-schema';
import type { Connection } from '../../client/providers/schema';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { ModelConfigPopover } from '../providers/model-config-popover';
import { SettingsGroup } from '../settings/settings-group';
import { withFixedModelPolicy, withModelAliasPolicy, withoutModelPolicy } from './automation-draft';
import { minutesWords } from './automation-words';

const MISSED_RUNS: readonly AutomationMissedRuns[] = ['runOnce', 'skip'];
/** Stop-after choices in minutes; a value saved outside them (the agent's tool) stays listed. */
const DURATIONS = [5, 10, 15, 30, 60, 120, 240];

function commandModelLabel(
  command: CommandDefinition | undefined,
  aliases: readonly ModelAlias[],
  t: TFunction<'automations'>,
): string {
  if (!command) return t('policy.useDefault');
  switch (command.model.mode) {
    case 'fixed':
      return t('policy.useCommandModel');
    case 'alias': {
      const { aliasId } = command.model;
      const alias = aliases.find((item) => item.id === aliasId);
      return alias
        ? t('policy.useCommandAlias', { alias: alias.name })
        : t('policy.useCommandModel');
    }
    case 'inherit':
      return t('policy.useDefault');
  }
}

function aliasOptionLabel(
  alias: ModelAlias,
  connections: readonly Connection[],
  tProviders: TFunction<'providers'>,
): string {
  const connection = connections.find((item) => item.connectionId === alias.connectionId);
  const modelName =
    connection?.catalog.find((item) => item.id === alias.modelId)?.name ?? alias.modelId;
  const parts = [alias.name, modelName];
  if (alias.thinkingLevel) parts.push(tProviders(`thinkingLevels.levels.${alias.thinkingLevel}`));
  return parts.join(' · ');
}

/**
 * "How it runs": the model a run uses, how long it may take, and, for a schedule or a watched
 * folder, what happens to runs missed while Atd was closed. A chain has nothing to miss, and an
 * idle trigger only fires while Atd is open, so neither offers it.
 */
export function PolicyFields({
  draft,
  onChange,
  settings,
  commands,
}: {
  draft: AutomationDraft;
  onChange: (draft: AutomationDraft) => void;
  settings: SettingsSnapshot | null;
  commands: readonly CommandDefinition[];
}) {
  const { t } = useTranslation('automations');
  const { t: tProviders } = useTranslation('providers');
  const { policy, action, trigger } = draft;
  const set = (next: AutomationPolicy) => onChange({ ...draft, policy: next });
  const command =
    action.kind === 'command' ? commands.find(({ id }) => id === action.commandId) : undefined;
  const connections = settings?.connections ?? [];
  const aliases = settings?.aliases ?? [];
  const missingAlias =
    Boolean(policy.aliasId) && !aliases.some((alias) => alias.id === policy.aliasId);
  const selectValue = policy.aliasId
    ? `alias:${policy.aliasId}`
    : policy.model
      ? 'fixed'
      : 'default';
  const usable = connections.filter(
    (connection) => connection.connected && connection.catalog.length,
  );
  const fallback =
    usable.find(({ connectionId }) => connectionId === settings?.defaultConnectionId) ?? usable[0];
  // The level a run really uses: the automation's own, else the command's (a command action), else
  // the pinned model's connection default (`commandThinkingLevel` is the service's own precedence);
  // none of those leaves the popover to show the pinned model's own default.
  const pinned = connections.find(
    ({ connectionId }) => connectionId === policy.model?.connectionId,
  );
  const inherited = commandThinkingLevel(undefined, command?.thinkingLevel);
  const effort = policy.thinkingLevel ?? inherited ?? pinned?.defaultThinkingLevel;
  const durations = [...new Set([...DURATIONS, policy.maxDurationMinutes])].sort((a, b) => a - b);
  const missable = trigger.kind === 'schedule' || trigger.kind === 'folder' ? trigger : null;
  return (
    <SettingsGroup
      id="automation-policy"
      title={t('policy.title')}
      description={missable ? t('policy.description') : t('policy.descriptionChain')}
    >
      <div className="run-settings">
        <div className="field-columns automation-single-column">
          <div className="settings-field">
            <Label htmlFor="automation-model">{t('policy.model')}</Label>
            <div className="flex flex-col gap-2">
              <Select
                value={selectValue}
                onValueChange={(value) => {
                  if (value === 'default') set(withoutModelPolicy(policy));
                  else if (value.startsWith('alias:'))
                    set(withModelAliasPolicy(policy, value.slice('alias:'.length)));
                  else if (fallback)
                    set(
                      withFixedModelPolicy(policy, {
                        connectionId: fallback.connectionId,
                        modelId: fallback.defaultModel || (fallback.catalog[0]?.id ?? ''),
                      }),
                    );
                }}
              >
                <SelectTrigger id="automation-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{commandModelLabel(command, aliases, t)}</SelectItem>
                  <SelectItem value="fixed" disabled={!fallback}>
                    {t('policy.useFixed')}
                  </SelectItem>
                  {(aliases.length > 0 || missingAlias) && (
                    <SelectGroup>
                      <SelectLabel>{t('policy.aliasGroup')}</SelectLabel>
                      {aliases.map((alias) => (
                        <SelectItem key={alias.id} value={`alias:${alias.id}`}>
                          {aliasOptionLabel(alias, connections, tProviders)}
                        </SelectItem>
                      ))}
                      {missingAlias && (
                        <SelectItem value={`alias:${policy.aliasId}`}>
                          {t('policy.unavailableAlias')}
                        </SelectItem>
                      )}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              {policy.model && (
                <ModelConfigPopover
                  connections={connections}
                  model={policy.model}
                  thinkingLevel={effort}
                  onModelChange={(model) => set(withFixedModelPolicy(policy, model))}
                  onThinkingLevelChange={(thinkingLevel) => set({ ...policy, thinkingLevel })}
                />
              )}
              {policy.model && policy.thinkingLevel && (
                <div className="flex items-center justify-between gap-2">
                  <p id="automation-effort-note" className="settings-field-note">
                    {t('policy.effortOwn')}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="shrink-0"
                    aria-describedby="automation-effort-note"
                    onClick={() => {
                      const next = { ...policy };
                      delete next.thinkingLevel;
                      set(next);
                    }}
                  >
                    {t('policy.effortReset')}
                  </Button>
                </div>
              )}
              {policy.model && !policy.thinkingLevel && (
                <p className="settings-field-note">
                  {inherited
                    ? t('policy.effortFromCommand', {
                        level: tProviders(`thinkingLevels.levels.${inherited}`),
                      })
                    : t('policy.effortFromConnection')}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="field-columns aligned-fields">
          <div className="settings-field">
            <Label htmlFor="automation-duration">{t('policy.maxDuration')}</Label>
            <div className="flex flex-col gap-2">
              <Select
                value={String(policy.maxDurationMinutes)}
                onValueChange={(value) => set({ ...policy, maxDurationMinutes: Number(value) })}
              >
                <SelectTrigger
                  id="automation-duration"
                  className="w-full"
                  aria-describedby="automation-duration-note"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {durations.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {minutesWords(minutes, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id="automation-duration-note" className="settings-field-note">
                {t('policy.maxDurationNote')}
              </p>
            </div>
          </div>
          {missable && (
            <div className="settings-field">
              <Label htmlFor="automation-missed">{t('policy.missedRuns')}</Label>
              <div className="flex flex-col gap-2">
                <Select
                  value={policy.missedRuns}
                  onValueChange={(value) => {
                    const missedRuns = MISSED_RUNS.find((item) => item === value);
                    if (missedRuns) set({ ...policy, missedRuns });
                  }}
                >
                  <SelectTrigger
                    id="automation-missed"
                    className="w-full"
                    aria-describedby="automation-missed-note"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MISSED_RUNS.map((choice) => (
                      <SelectItem key={choice} value={choice}>
                        {t(`policy.missed.${choice}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p id="automation-missed-note" className="settings-field-note">
                  {t(`policy.missedNote.${missable.kind}`)}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </SettingsGroup>
  );
}
