import { useId } from 'react';
import { CircleAlert } from 'lucide-react';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from '@ai/ui/components/item';
import { Label } from '@ai/ui/components/label';
import { Switch } from '@ai/ui/components/switch';

/**
 * One on/off setting as a settings row: the title and a wrapping description, with the switch at
 * the trailing edge. The whole row toggles the switch, which is named by the title alone and
 * described by the description and the note. Render it inside an `ItemGroup`, either in a
 * `.settings-card` (hairlines divide the rows) or on its own in a list of rows.
 */
export function SettingsSwitchRow({
  id,
  title,
  description,
  checked,
  onCheckedChange,
  pending = false,
  disabled = false,
  note,
  anchor,
}: {
  /** The switch's id, which the row's label points at. */
  id: string;
  title: string;
  description?: string | undefined;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /**
   * A save of this setting is in flight: the switch stays focusable, is marked busy and
   * unavailable, and ignores input until the save settles.
   */
  pending?: boolean | undefined;
  /** The setting cannot change at all, such as without the desktop bridge or a snapshot. */
  disabled?: boolean;
  /**
   * An error or a next step shown under the row, beside what caused it (`.settings-inline-error`).
   * It is announced when it appears.
   */
  note?: string | undefined;
  /** The `data-settings-anchor` that settings search reveals. */
  anchor?: string;
}) {
  const ids = useId();
  const describedBy = [description && `${ids}-description`, note && `${ids}-note`]
    .filter(Boolean)
    .join(' ');
  return (
    <Item asChild size="sm" className="settings-card-row settings-preference-row">
      <li data-settings-anchor={anchor}>
        <Label htmlFor={id} className="min-w-[min(120px,100%)] flex-1">
          <ItemContent>
            <ItemTitle id={`${ids}-title`} className="whitespace-normal">
              {title}
            </ItemTitle>
            {description && (
              <ItemDescription id={`${ids}-description`} className="whitespace-normal">
                {description}
              </ItemDescription>
            )}
          </ItemContent>
        </Label>
        <ItemActions className="ml-auto">
          <Switch
            id={id}
            aria-labelledby={`${ids}-title`}
            aria-describedby={describedBy || undefined}
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
            checked={checked}
            disabled={disabled}
            onCheckedChange={(value) => {
              if (!pending) onCheckedChange(value);
            }}
          />
        </ItemActions>
        {note && (
          <ItemFooter
            id={`${ids}-note`}
            role="alert"
            className="settings-inline-error items-start justify-start"
          >
            <CircleAlert aria-hidden="true" />
            <span>{note}</span>
          </ItemFooter>
        )}
      </li>
    </Item>
  );
}
