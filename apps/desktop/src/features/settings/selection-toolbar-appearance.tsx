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
  SELECTION_TOOLBAR_ICON_MODES,
  SELECTION_TOOLBAR_POSITIONS,
} from '../../client/settings-contract';
import type { useSelectionToolbarSettings } from './use-selection-toolbar-settings';

/** One option of a choice row: the saved value and the label its menu shows. */
interface Choice<T extends string> {
  value: T;
  label: string;
}

/**
 * A settings row that picks one value from a menu, with the chosen behavior described under the
 * title. Like the activation select, it is disabled while settings are unavailable, marked busy
 * while a save runs, and shows that save's failure below; the select wraps below the text at
 * narrow widths.
 */
function ChoiceRow<T extends string>({
  anchor,
  title,
  description,
  label,
  value,
  choices,
  disabled,
  pending,
  error,
  onChange,
}: {
  anchor: string;
  title: string;
  description: string;
  /** The select's accessible name. */
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  disabled: boolean;
  pending: boolean;
  error: string | undefined;
  onChange: (value: T) => void;
}) {
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li data-settings-anchor={anchor}>
        {/* Wide enough that the select wraps below a long description in a narrow column. */}
        <ItemContent className="min-w-[min(200px,100%)]">
          <ItemTitle className="whitespace-normal">{title}</ItemTitle>
          <ItemDescription className="whitespace-normal">{description}</ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto flex-wrap justify-end">
          <Select
            value={value}
            disabled={disabled}
            onValueChange={(next) => {
              const choice = choices.find((item) => item.value === next);
              if (!pending && choice) onChange(choice.value);
            }}
          >
            <SelectTrigger size="sm" aria-label={label} aria-busy={pending || undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
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

/**
 * General › Selection toolbar: how the toolbar first appears. What a selection shows first (a
 * small icon that expands on a click or on hover, or the whole toolbar), whatever the activation;
 * and, only while the whole toolbar comes up at once, where it appears, since the small icon always
 * sits by the pointer. Settings only: the welcome guide keeps to the activation.
 */
export function SelectionToolbarAppearanceRows({
  settings,
}: {
  settings: ReturnType<typeof useSelectionToolbarSettings>;
}) {
  const { t } = useTranslation('settings');
  const { smallIcon, position } = settings.value;
  return (
    <>
      <ChoiceRow
        anchor="settings-selection-toolbar-small-icon"
        title={t('selectionToolbar.smallIcon.title')}
        description={t(`selectionToolbar.smallIcon.hints.${smallIcon}`)}
        label={t('selectionToolbar.smallIcon.label')}
        value={smallIcon}
        choices={SELECTION_TOOLBAR_ICON_MODES.map((mode) => ({
          value: mode,
          label: t(`selectionToolbar.smallIcon.modes.${mode}`),
        }))}
        disabled={settings.unavailable}
        pending={settings.pending}
        error={settings.errors.smallIcon}
        onChange={settings.setSmallIcon}
      />
      {smallIcon === 'off' && (
        <ChoiceRow
          anchor="settings-selection-toolbar-position"
          title={t('selectionToolbar.position.title')}
          description={t(`selectionToolbar.position.hints.${position}`)}
          label={t('selectionToolbar.position.label')}
          value={position}
          choices={SELECTION_TOOLBAR_POSITIONS.map((place) => ({
            value: place,
            label: t(`selectionToolbar.position.modes.${place}`),
          }))}
          disabled={settings.unavailable}
          pending={settings.pending}
          error={settings.errors.position}
          onChange={settings.setPosition}
        />
      )}
    </>
  );
}
