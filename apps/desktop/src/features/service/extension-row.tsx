import type { ReactNode } from 'react';
import { Ellipsis, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ai/ui/components/dropdown-menu';
import { Item, ItemActions } from '@ai/ui/components/item';
import { Switch } from '@ai/ui/components/switch';
import { IconButton } from '../../components/icon-button';

/**
 * One skill, subagent or MCP row. A button under the row's content opens the details, so a click
 * anywhere on the row does; the content ignores the pointer (settings.css) while the trailing
 * actions and any inline field stay interactive above that button.
 */
export function ExtensionRow({
  name,
  onDetails,
  children,
}: {
  name: string;
  onDetails: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('settings');
  return (
    <Item asChild size="xs" className="settings-open-row">
      <li>
        <button
          type="button"
          className="settings-open-row-button"
          aria-label={t('extensions.viewDetailsFor', { name })}
          onClick={onDetails}
        />
        {children}
      </li>
    </Item>
  );
}

/**
 * The trailing actions every skill, subagent and MCP row shares: the enable switch, then More when
 * the row has secondary actions (`menu`). More repeats the details first, since a click on the row
 * opens them anyway; a row with nothing else skips More. `reserveMenu` keeps More's column empty
 * when a sibling row shows it, so the switches stay aligned within a list.
 */
export function ExtensionRowActions({
  name,
  enabled,
  disabled,
  onEnabledChange,
  onDetails,
  menu,
  reserveMenu = false,
}: {
  name: string;
  enabled: boolean;
  /** Locks the switch, as while the service is disconnected or the row is saving. */
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onDetails: () => void;
  menu?: ReactNode;
  reserveMenu?: boolean;
}) {
  const { t } = useTranslation('settings');
  return (
    <ItemActions>
      <Switch
        aria-label={t('extensions.enableFor', { name })}
        checked={enabled}
        disabled={disabled}
        onCheckedChange={onEnabledChange}
      />
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label={t('extensions.more')}
              aria-label={t('extensions.moreActionsFor', { name })}
              tooltipDismissOnClick
            >
              <Ellipsis />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onDetails}>
              <Info />
              {t('extensions.viewDetails')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {menu}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : reserveMenu ? (
        <span className="size-7 shrink-0" aria-hidden />
      ) : null}
    </ItemActions>
  );
}
