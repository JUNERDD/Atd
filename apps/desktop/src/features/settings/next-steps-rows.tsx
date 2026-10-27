import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from '@atd/ui/components/item';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import {
  DEFAULT_NEXT_STEP_CLICK,
  DEFAULT_NEXT_STEPS,
  type NextStepClick,
  type SettingsSnapshot,
} from '../../client/settings-contract';
import { useSettingsSectionExit } from './settings-navigation';
import { SettingsSwitchRow } from './settings-switch-row';

const NEXT_STEP_CLICKS = ['fill', 'send'] as const satisfies readonly NextStepClick[];

function isNextStepClick(value: string): value is NextStepClick {
  return (NEXT_STEP_CLICKS as readonly string[]).includes(value);
}

/**
 * Runs one preference save with its own pending flag and error, which leaving the section clears,
 * so each row reports its failure beside itself.
 */
function useSaving(failedMessage: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useSettingsSectionExit(() => setError(undefined));

  async function run(save: () => Promise<unknown>) {
    if (pending) return;
    setError(undefined);
    setPending(true);
    try {
      await save();
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : failedMessage);
    }
    setPending(false);
  }

  return { pending, error, run };
}

/** Whether finished conversations get suggested next steps. */
export function NextStepsRow({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const save = window.desktop?.settings.setNextSteps;
  const { pending, error, run } = useSaving(t('shortcuts.nextSteps.saveFailed'));

  return (
    <SettingsSwitchRow
      id="settings-next-steps"
      anchor="settings-next-steps"
      title={t('shortcuts.nextSteps.title')}
      description={t('shortcuts.nextSteps.description')}
      checked={snapshot?.nextSteps ?? DEFAULT_NEXT_STEPS}
      disabled={!snapshot || !save}
      pending={pending}
      note={error}
      onCheckedChange={(enabled) => save && void run(() => save(enabled))}
    />
  );
}

/**
 * What a click on a suggested follow-up does. It depends on the suggestions, so it stays in place
 * but is unavailable while they are off, which keeps the layout and the search anchor stable.
 */
export function NextStepClickRow({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const descriptionId = useId();
  const save = window.desktop?.settings.setNextStepClick;
  const { pending, error, run } = useSaving(t('shortcuts.nextStepClick.saveFailed'));
  const value = snapshot?.nextStepClick ?? DEFAULT_NEXT_STEP_CLICK;
  const unavailable = !snapshot || !save || !snapshot.nextSteps;

  return (
    <Item asChild size="sm" className="settings-card-row">
      <li data-settings-anchor="settings-next-step-click">
        {/* Wide enough that the select wraps below a long description in a narrow column. */}
        <ItemContent className="min-w-[min(200px,100%)]">
          <ItemTitle className="whitespace-normal">{t('shortcuts.nextStepClick.title')}</ItemTitle>
          <ItemDescription id={descriptionId} className="whitespace-normal">
            {t('shortcuts.nextStepClick.description')}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto flex-wrap justify-end">
          <Select
            value={value}
            disabled={unavailable}
            onValueChange={(next) => {
              if (save && isNextStepClick(next)) void run(() => save(next));
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t('shortcuts.nextStepClick.label')}
              aria-describedby={descriptionId}
              aria-busy={pending || undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NEXT_STEP_CLICKS.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(`shortcuts.nextStepClick.modes.${mode}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ItemActions>
        {error && (
          <ItemFooter role="alert" className="settings-inline-error items-start justify-start">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </ItemFooter>
        )}
      </li>
    </Item>
  );
}
