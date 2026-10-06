import { useTranslation } from 'react-i18next';
import type {
  AutomationDraft,
  AutomationMissedRuns,
  AutomationPolicy,
  FolderRef,
  PermissionTier,
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
import type { SettingsSnapshot } from '../../client/settings-contract';
import { ModelConfigPopover } from '../providers/model-config-popover';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { chosenTools, PROMPT_TOOLS, withTools, type DraftPatch } from './automation-draft';
import { FolderListField } from './folder-list-field';
import type { AutomationProblemsView } from './use-automation-problems';

const TIERS: readonly PermissionTier[] = ['manual', 'auto', 'always'];
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
 * "How it runs": what an unattended run may do (its approval tier, explained for when nobody is
 * there to approve), its tools (a prompt's; a command brings its own), model, memory, the folders
 * it may read, how long it may take, and what happens to runs missed while Atd was closed.
 */
export function PolicyFields({
  draft,
  onChange,
  patch,
  settings,
  commands,
  folderName,
  onFoldersPicked,
  problems,
}: {
  draft: AutomationDraft;
  onChange: (draft: AutomationDraft) => void;
  /** For folder picks, which land after other edits. */
  patch: DraftPatch;
  settings: SettingsSnapshot | null;
  commands: readonly CommandDefinition[];
  /** A folder's name; undefined once it is no longer registered. */
  folderName: (folderId: string) => string | undefined;
  onFoldersPicked: (folders: readonly FolderRef[]) => void;
  problems: AutomationProblemsView;
}) {
  const { t } = useTranslation('automations');
  const { t: tCommon } = useTranslation('common');
  const { t: tSettings } = useTranslation('settings');
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
  const tools = chosenTools(policy);
  const durations = [...new Set([...DURATIONS, policy.maxDurationMinutes])].sort((a, b) => a - b);
  const durationText = (minutes: number) =>
    minutes % 60 === 0
      ? t('policy.hours', { count: minutes / 60 })
      : t('policy.minutes', { count: minutes });
  return (
    <section className="settings-field" aria-labelledby="automation-policy-title">
      <h3 id="automation-policy-title" className="settings-section-title">
        {t('policy.title')}
      </h3>
      <div className="run-settings">
        <div className="field-columns aligned-fields">
          <div className="settings-field">
            <Label htmlFor="automation-tier">{t('policy.tier')}</Label>
            <div className="flex flex-col gap-2">
              <Select
                value={policy.permissionTier}
                onValueChange={(value) => {
                  const tier = TIERS.find((item) => item === value);
                  if (tier) set({ ...policy, permissionTier: tier });
                }}
              >
                <SelectTrigger
                  id="automation-tier"
                  className="w-full"
                  aria-describedby="automation-tier-note"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIERS.map((tier) => (
                    <SelectItem key={tier} value={tier}>
                      {tSettings(`permissions.tiers.${tier}.label`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id="automation-tier-note" className="settings-field-note">
                {t(`policy.tiers.${policy.permissionTier}`)}
              </p>
            </div>
          </div>
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
                  thinkingLevel={policy.thinkingLevel ?? 'off'}
                  onModelChange={(model) => set({ ...policy, model })}
                  onThinkingLevelChange={(thinkingLevel) => set({ ...policy, thinkingLevel })}
                />
              )}
            </div>
          </div>
        </div>
        {action.kind === 'prompt' ? (
          <div className="settings-field">
            <Label id="automation-tools-label">{t('policy.tools')}</Label>
            <Card size="sm" className="settings-card">
              <ItemGroup aria-labelledby="automation-tools-label">
                {PROMPT_TOOLS.map((tool) => (
                  <SettingsSwitchRow
                    key={tool}
                    id={`automation-tool-${tool}`}
                    title={tCommon(`tools.${tool}.label`)}
                    description={tCommon(`tools.${tool}.description`)}
                    checked={tools.includes(tool)}
                    onCheckedChange={(checked) =>
                      set(
                        withTools(
                          policy,
                          checked ? [...tools, tool] : tools.filter((item) => item !== tool),
                        ),
                      )
                    }
                  />
                ))}
              </ItemGroup>
            </Card>
          </div>
        ) : (
          <p className="settings-field-note">{t('policy.commandTools')}</p>
        )}
        <Card size="sm" className="settings-card">
          <ItemGroup>
            <SettingsSwitchRow
              id="automation-memory"
              title={t('policy.memory')}
              description={t('policy.memoryDescription')}
              checked={policy.memory}
              onCheckedChange={(memory) => set({ ...policy, memory })}
            />
          </ItemGroup>
        </Card>
        <FolderListField
          folderIds={policy.folderIds}
          patch={patch}
          folderName={folderName}
          onFoldersPicked={onFoldersPicked}
          error={problems.text('folders')}
        />
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
                      {durationText(minutes)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id="automation-duration-note" className="settings-field-note">
                {t('policy.maxDurationNote')}
              </p>
            </div>
          </div>
          {trigger.kind !== 'automation' && (
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
                  {t(`policy.missedNote.${trigger.kind}`)}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
