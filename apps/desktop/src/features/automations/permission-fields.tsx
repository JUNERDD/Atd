import { useTranslation } from 'react-i18next';
import type { AutomationDraft, FolderRef, PermissionTier } from '@atd/agent-contracts';
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
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { SettingsGroup } from '../settings/settings-group';
import { chosenTools, PROMPT_TOOLS, withTools, type DraftPatch } from './automation-draft';
import { FolderListField } from './folder-list-field';
import type { AutomationProblemsView } from './use-automation-problems';

const TIERS: readonly PermissionTier[] = ['manual', 'auto', 'always'];

/**
 * "Permissions": what an unattended run may do and read on its own: its approval tier, explained
 * for when nobody is there to approve, its tools (a prompt's; a command brings its own), memory,
 * and the folders it may read. Consolidating memory uses none of them, so the section only says
 * so; the policy keeps its values for a switch back to a prompt or command.
 */
export function PermissionFields({
  draft,
  onChange,
  patch,
  folderName,
  onFoldersPicked,
  problems,
}: {
  draft: AutomationDraft;
  onChange: (draft: AutomationDraft) => void;
  /** For folder picks, which land after other edits. */
  patch: DraftPatch;
  /** A folder's name; undefined once it is no longer registered. */
  folderName: (folderId: string) => string | undefined;
  onFoldersPicked: (folders: readonly FolderRef[]) => void;
  problems: AutomationProblemsView;
}) {
  const { t } = useTranslation('automations');
  const { t: tCommon } = useTranslation('common');
  const { t: tSettings } = useTranslation('settings');
  const { policy, action } = draft;
  const set = (next: AutomationDraft['policy']) => onChange({ ...draft, policy: next });
  const tools = chosenTools(policy);
  if (action.kind === 'consolidateMemory')
    return (
      <SettingsGroup
        id="automation-permissions"
        title={t('permissions.title')}
        description={t('permissions.notApplicable')}
      />
    );
  return (
    <SettingsGroup
      id="automation-permissions"
      title={t('permissions.title')}
      description={t('permissions.description')}
    >
      <div className="run-settings">
        <div className="field-columns automation-single-column">
          <div className="settings-field">
            <Label htmlFor="automation-tier">{t('policy.tier')}</Label>
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
          </div>
        </div>
        <p id="automation-tier-note" className="settings-field-note">
          {t(`policy.tiers.${policy.permissionTier}`)}
        </p>
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
      </div>
    </SettingsGroup>
  );
}
