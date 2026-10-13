import { useTranslation } from 'react-i18next';
import {
  commandThinkingLevel,
  type AutomationDraft,
  type AutomationMissedRuns,
  type AutomationPolicy,
} from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import type { CommandDefinition } from '../../client/agent/command-schema';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { ModelConfigPopover } from '../providers/model-config-popover';
import { SettingsGroup } from '../settings/settings-group';
import { minutesWords } from './automation-words';

const MISSED_RUNS: readonly AutomationMissedRuns[] = ['runOnce', 'skip'];
/** Stop-after choices in minutes; a value saved outside them (the agent's tool) stays listed. */
const DURATIONS = [5, 10, 15, 30, 60, 120, 240];

/** The policy without a model of its own: runs take the command's or the app's default. */
function withoutModel(policy: AutomationPolicy): AutomationPolicy {
  const next = { ...policy };
  delete next.model;
  delete next.thinkingLevel;
  return next;
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
                value={policy.model ? 'fixed' : 'default'}
                onValueChange={(value) => {
                  if (value === 'default') set(withoutModel(policy));
                  else if (fallback)
                    set({
                      ...policy,
                      model: {
                        connectionId: fallback.connectionId,
                        modelId: fallback.defaultModel || (fallback.catalog[0]?.id ?? ''),
                      },
                    });
                }}
              >
                <SelectTrigger id="automation-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">
                    {command?.model.mode === 'fixed'
                      ? t('policy.useCommandModel')
                      : t('policy.useDefault')}
                  </SelectItem>
                  <SelectItem value="fixed" disabled={!fallback}>
                    {t('policy.useFixed')}
                  </SelectItem>
                </SelectContent>
              </Select>
              {policy.model && (
                <ModelConfigPopover
                  connections={connections}
                  model={policy.model}
                  thinkingLevel={effort}
                  onModelChange={(model) => set({ ...policy, model })}
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
