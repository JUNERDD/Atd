import { useId, useState, type ReactNode } from 'react';
import { Ellipsis, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { Item, ItemActions } from '@atd/ui/components/item';
import { Switch } from '@atd/ui/components/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import { IconButton } from '../../components/icon-button';

/**
 * One plugin, skill, subagent, MCP server or command row. A button under the row's content opens the details, so a click
 * anywhere on the row does; the content ignores the pointer (settings.css) while the trailing
 * actions and any inline field stay interactive above that button.
 */
export function ExtensionRow({
  name,
  onDetails,
  className,
  children,
}: {
  name: string;
  onDetails: () => void;
  /** A row layout on top of the shared anatomy, such as the plugin row's two-line grid. */
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation('settings');
  return (
    <Item
      asChild
      size="xs"
      className={className ? `settings-open-row ${className}` : 'settings-open-row'}
    >
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
 * The trailing actions every plugin, skill, subagent and MCP row shares: the enable switch, then
 * More when the row has secondary actions (`menu`). More repeats the details first, since a click
 * on the row opens them anyway. A row without More holds an empty slot in More's column, which
 * settings.css shows only while another list row on the same page fills that column, so the
 * switches line up without leaving a blank column on a page where no row has More. While its
 * plugin is off, an item's switch is locked and `lockedReason` says why on hover and focus. While
 * a write for the row runs (`pending`), the switch keeps its focus and ignores changes.
 */
export function ExtensionRowActions({
  name,
  enabled,
  disabled,
  onEnabledChange,
  onDetails,
  menu,
  trailing,
  showSwitch = true,
  lockedReason = null,
  pending = false,
  leading,
  reserveMore = true,
}: {
  name: string;
  enabled: boolean;
  /** Locks the switch because it cannot work at all, as while the service is disconnected. */
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onDetails: () => void;
  /** Secondary actions; without them there is no More, since a click on the row opens details. */
  menu?: ReactNode;
  /** A control in More's column instead of More, such as Open in Commands. */
  trailing?: ReactNode;
  showSwitch?: boolean;
  /** Why the switch is locked beyond `disabled`; shown in a tooltip. */
  lockedReason?: string | null;
  /** A write for this row is running: the switch stays focusable (`aria-busy`) but inert. */
  pending?: boolean;
  /** A control before the switch, such as a link to the section that owns the item. */
  leading?: ReactNode;
  /**
   * Holds More's slot when there is no More, so the switches of a list can line up. A card has no
   * neighbouring row to line up with, so its switch takes the trailing edge instead.
   */
  reserveMore?: boolean;
}) {
  const { t } = useTranslation('settings');
  const reasonId = useId();
  const [tip, setTip] = useState(false);
  const locked = Boolean(lockedReason);
  // Locked by its plugin or busy saving, the switch stays focusable (`aria-disabled`, not
  // `disabled`) and ignores changes, so a tooltip can say why and a save keeps the focus. The
  // tooltip hangs on a wrapper: as the trigger itself it would replace the switch's checked
  // `data-state`. Keyboard focus opens it like hover does.
  const toggle = (
    <Switch
      aria-label={t('extensions.enableFor', { name })}
      aria-describedby={locked ? reasonId : undefined}
      aria-disabled={locked || pending || undefined}
      aria-busy={pending || undefined}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      checked={enabled}
      disabled={disabled}
      onCheckedChange={(checked) => {
        if (!locked && !pending) onEnabledChange(checked);
      }}
      onFocus={(event) => {
        if (locked && event.currentTarget.matches(':focus-visible')) setTip(true);
      }}
      onBlur={() => setTip(false)}
    />
  );
  return (
    <ItemActions data-more-column={trailing || menu ? '' : undefined}>
      {leading}
      {!showSwitch ? null : locked ? (
        <Tooltip open={tip} onOpenChange={setTip}>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              {toggle}
              <span id={reasonId} className="sr-only">
                {lockedReason}
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={4}>
            {lockedReason}
          </TooltipContent>
        </Tooltip>
      ) : (
        toggle
      )}
      {trailing ? (
        trailing
      ) : menu ? (
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
            {menu ? (
              <>
                <DropdownMenuSeparator />
                {menu}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : reserveMore ? (
        <span className="settings-row-more-slot size-7 shrink-0" aria-hidden />
      ) : null}
    </ItemActions>
  );
}
