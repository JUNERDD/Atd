import { useTranslation } from 'react-i18next';
import type { AutomationItem, AutomationTrigger } from '@atd/agent-contracts';
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
import { FieldError } from '../commands/field-error';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { AUTOMATION_RESULTS } from './automation-words';
import { errorId, type AutomationProblemsView } from './use-automation-problems';

type ChainTrigger = Extract<AutomationTrigger, { kind: 'automation' }>;

/**
 * A chain trigger's fields: the automation whose finished runs start this one (never itself;
 * the service reports a chain that would loop), and which of its results count.
 */
export function ChainTriggerFields({
  trigger,
  onChange,
  automationId,
  automations,
  problems,
}: {
  trigger: ChainTrigger;
  onChange: (trigger: ChainTrigger) => void;
  automationId: string | null;
  automations: readonly AutomationItem[] | null;
  problems: AutomationProblemsView;
}) {
  const { t, i18n } = useTranslation('automations');
  const collator = new Intl.Collator(i18n.language, { numeric: true, sensitivity: 'base' });
  const others = (automations ?? [])
    .filter(({ automation }) => automation.id !== automationId)
    .sort((a, b) => collator.compare(a.automation.name, b.automation.name));
  // A followed automation deleted since stays chosen, named as gone, until another is picked.
  const gone =
    trigger.automationId !== '' &&
    automations !== null &&
    !others.some(({ automation }) => automation.id === trigger.automationId);
  const chainError = problems.text('chain');
  const outcomesError = problems.text('outcomes');
  return (
    <div className="automation-field-stack">
      <div className="settings-field">
        <Label htmlFor="automation-chain">{t('chain.after')}</Label>
        <Select
          value={trigger.automationId}
          disabled={!others.length && !trigger.automationId}
          onValueChange={(value) => onChange({ ...trigger, automationId: value })}
        >
          <SelectTrigger
            id="automation-chain"
            className="w-full"
            aria-invalid={Boolean(chainError) || undefined}
            aria-describedby={chainError ? errorId('chain') : undefined}
          >
            <SelectValue placeholder={others.length ? t('chain.choose') : t('chain.noOthers')} />
          </SelectTrigger>
          <SelectContent>
            {others.map(({ automation }) => (
              <SelectItem key={automation.id} value={automation.id}>
                {automation.name}
              </SelectItem>
            ))}
            {gone && (
              <SelectItem value={trigger.automationId} disabled>
                {t('summary.deletedAutomation')}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        {chainError && <FieldError id={errorId('chain')}>{chainError}</FieldError>}
      </div>
      <div className="settings-field">
        <Label id="automation-outcomes-label">{t('chain.outcomes')}</Label>
        <Card size="sm" className="settings-card">
          <ItemGroup aria-labelledby="automation-outcomes-label">
            {AUTOMATION_RESULTS.map((result) => (
              <SettingsSwitchRow
                key={result}
                id={`automation-outcome-${result}`}
                title={t(`chain.outcome.${result}.title`)}
                description={t(`chain.outcome.${result}.description`)}
                checked={trigger.outcomes.includes(result)}
                onCheckedChange={(checked) =>
                  onChange({
                    ...trigger,
                    outcomes: checked
                      ? [...trigger.outcomes, result]
                      : trigger.outcomes.filter((item) => item !== result),
                  })
                }
              />
            ))}
          </ItemGroup>
        </Card>
        {outcomesError && <FieldError id={errorId('outcomes')}>{outcomesError}</FieldError>}
      </div>
    </div>
  );
}
