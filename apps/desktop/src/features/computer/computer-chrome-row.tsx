import { Globe, MoreHorizontal, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@atd/ui/components/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import type { ComputerChromeConnection } from '../../client/computer-contract';
import { IconButton } from '../../components/icon-button';
import { ItemContextMenu, ItemMenuItem } from '../../components/item-menu';

/**
 * One paired Chrome profile, in the anatomy of a target row: the browser icon, the profile's label
 * with Connected while its extension holds a connection, then the browser and email where the
 * label does not already say them, how many sites the person allowed from the extension, and when
 * it was last connected while it is not; More in a fixed place. More (and a right-click on the
 * row) holds Disconnect.
 */
export function ComputerChromeRow({
  connection,
  disabled,
  onDisconnect,
}: {
  connection: ComputerChromeConnection;
  /** Nothing can change: no service connection. */
  disabled: boolean;
  onDisconnect: (connection: ComputerChromeConnection) => void;
}) {
  const { t, i18n } = useTranslation('settings');
  const { label, email, browser, connected, sites } = connection;
  const lastSeen = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(connection.lastSeenAt));
  const description = [
    browser === label ? null : browser,
    email && email !== label ? email : null,
    sites ? t('computer.chrome.sites', { count: sites }) : t('computer.chrome.noSites'),
    connected ? null : t('computer.chrome.lastSeen', { time: lastSeen }),
  ]
    .filter(Boolean)
    .join(' · ');
  const menu = (
    <ItemMenuItem
      variant="destructive"
      disabled={disabled}
      onSelect={() => onDisconnect(connection)}
    >
      <Unplug />
      {t('computer.chrome.disconnect')}
    </ItemMenuItem>
  );
  return (
    <ItemContextMenu menu={menu}>
      <Item asChild size="sm" className="settings-card-row">
        <li>
          <ItemMedia variant="icon">
            <Globe />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="min-w-0">
              <span className="truncate" title={label}>
                {label}
              </span>
              {connected && <Badge variant="secondary">{t('computer.chrome.connected')}</Badge>}
            </ItemTitle>
            <ItemDescription className="truncate" title={description}>
              {description}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  label={t('computer.targets.more')}
                  aria-label={t('computer.targets.moreFor', { name: label })}
                  tooltip={false}
                >
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
            </DropdownMenu>
          </ItemActions>
        </li>
      </Item>
    </ItemContextMenu>
  );
}
