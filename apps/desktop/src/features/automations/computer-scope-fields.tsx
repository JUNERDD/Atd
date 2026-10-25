import { useTranslation } from 'react-i18next';
import {
  COMPUTER_MAX_SUBMITS,
  COMPUTER_TEXT_MAX_LENGTH,
  type AutomationDraft,
  type AutomationItem,
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
import { targetDetail } from '../computer/computer-target-words';
import { useComputerStatus } from '../computer/use-computer';
import { SettingsGroup } from '../settings/settings-group';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { ComputerAuthorization } from './computer-authorization';
import { ComputerStepRow } from './computer-step-row';
import { conditionWords, withMaxLength, withTargets } from './computer-scope';

const SUBMIT_LIMITS = Array.from({ length: COMPUTER_MAX_SUBMITS }, (_, index) => index + 1);

/**
 * "Computer use": what an automation may do on registered websites and apps. The steps come
 * from a task where Atd did the work with the person, so here they read as a summary; a person
 * picks the targets, tightens how much text each fill may enter and how many submits a
 * run may make, and reads the condition that alone counts a run as done. Acting on it needs a
 * trial and an authorization (`ComputerAuthorization`). Consolidating memory never acts on a
 * computer, so the section only says so.
 */
export function ComputerScopeFields({
  draft,
  onChange,
  saved,
  dirty,
  pending,
  onSaveAndAuthorize,
}: {
  draft: AutomationDraft;
  onChange: (draft: AutomationDraft) => void;
  saved: AutomationItem | null;
  dirty: boolean;
  pending: boolean;
  onSaveAndAuthorize: () => void;
}) {
  const { t } = useTranslation('automations');
  const { available, status } = useComputerStatus();
  const scope = draft.policy.computer;
  if (draft.action.kind === 'consolidateMemory')
    return scope ? (
      <SettingsGroup
        id="automation-computer"
        title={t('computer.title')}
        description={t('computer.notApplicable')}
      />
    ) : null;
  // A scope comes only from a task Atd worked through with the person; the group says where.
  if (!scope)
    return available ? (
      <SettingsGroup
        id="automation-computer"
        title={t('computer.title')}
        description={t('computer.noScope')}
      />
    ) : null;
  const set = (next: typeof scope) =>
    onChange({ ...draft, policy: { ...draft.policy, computer: next } });
  const bindings = status?.bindings ?? [];
  const labels = new Map(bindings.map((binding) => [binding.bindingId, binding.label]));
  const gone = scope.bindingIds.filter((id) => !labels.has(id));
  const toggle = (bindingId: string, on: boolean) =>
    set(
      withTargets(
        scope,
        on ? [...scope.bindingIds, bindingId] : scope.bindingIds.filter((id) => id !== bindingId),
      ),
    );
  return (
    <SettingsGroup
      id="automation-computer"
      title={t('computer.title')}
      description={t('computer.description')}
    >
      <div className="run-settings">
        <div className="settings-field">
          <Label id="automation-computer-targets-label">{t('computer.targets')}</Label>
          <Card size="sm" className="settings-card">
            <ItemGroup aria-labelledby="automation-computer-targets-label">
              {bindings.map((binding) => {
                const on = scope.bindingIds.includes(binding.bindingId);
                return (
                  <SettingsSwitchRow
                    key={binding.bindingId}
                    id={`automation-computer-target-${binding.bindingId}`}
                    title={binding.label}
                    description={targetDetail(binding)}
                    checked={on}
                    // A scope names at least one target.
                    disabled={on && scope.bindingIds.length === 1}
                    onCheckedChange={(next) => toggle(binding.bindingId, next)}
                  />
                );
              })}
              {gone.map((bindingId) => (
                <SettingsSwitchRow
                  key={bindingId}
                  id={`automation-computer-target-${bindingId}`}
                  title={t('computer.targetGone')}
                  description={t('computer.targetGoneDescription')}
                  checked
                  disabled={scope.bindingIds.length === 1}
                  onCheckedChange={() => toggle(bindingId, false)}
                />
              ))}
            </ItemGroup>
          </Card>
          {/* Says why the last target's switch can't be turned off. */}
          {scope.bindingIds.length === 1 && (
            <p className="settings-field-note">{t('computer.targetsNote')}</p>
          )}
        </div>
        <div className="settings-field">
          <Label id="automation-computer-steps-label">{t('computer.steps')}</Label>
          <Card size="sm" className="settings-card">
            <ItemGroup aria-labelledby="automation-computer-steps-label">
              {scope.recipe.steps.map((step, index) => (
                <ComputerStepRow
                  key={step.stepId}
                  step={step}
                  index={index}
                  target={labels.get(step.bindingId) ?? t('computer.targetGone')}
                  unpicked={!scope.bindingIds.includes(step.bindingId)}
                  maxLengthLimit={COMPUTER_TEXT_MAX_LENGTH}
                  onMaxLength={(maxLength) => set(withMaxLength(scope, step.stepId, maxLength))}
                />
              ))}
            </ItemGroup>
          </Card>
          <p className="settings-field-note">{t('computer.stepsNote')}</p>
        </div>
        <div className="field-columns automation-single-column">
          <div className="settings-field">
            <Label htmlFor="automation-computer-submits">{t('computer.maxSubmits')}</Label>
            <Select
              value={String(scope.maxSubmits)}
              onValueChange={(value) => {
                const limit = SUBMIT_LIMITS.find((item) => String(item) === value);
                if (limit) set({ ...scope, maxSubmits: limit });
              }}
            >
              <SelectTrigger
                id="automation-computer-submits"
                className="w-full"
                aria-describedby="automation-computer-submits-note"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBMIT_LIMITS.map((limit) => (
                  <SelectItem key={limit} value={String(limit)}>
                    {t('computer.submitsValue', { count: limit })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p id="automation-computer-submits-note" className="settings-field-note">
          {t('computer.maxSubmitsNote')}
        </p>
        <div className="settings-field">
          <Label id="automation-computer-completion-label">{t('computer.completion')}</Label>
          <p className="m-0 text-sm wrap-anywhere">{conditionWords(scope.completion, t)}</p>
          <p className="settings-field-note">{t('computer.completionNote')}</p>
        </div>
        <ComputerAuthorization
          saved={saved}
          dirty={dirty}
          pending={pending}
          onSaveAndAuthorize={onSaveAndAuthorize}
        />
      </div>
    </SettingsGroup>
  );
}
