import { LogIn, MoreHorizontal, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TargetBinding } from '@atd/agent-contracts';
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
import { IconButton } from '../../components/icon-button';
import { ItemContextMenu, ItemMenuItem, ItemMenuSeparator } from '../../components/item-menu';
import { TargetIcon } from './computer-target-icon';
import { targetDetail, targetKind } from './computer-target-words';

/**
 * One registered target, the same row for a browser environment and an application: the kind's
 * icon, the name with In use while a run acts on it, the kind with the allowed sites or the app,
 * and More in a fixed place. More (and a right-click on the row) holds Sign in again for a browser
 * environment and Disconnect for every target.
 */
export function ComputerTargetRow({
  binding,
  busy,
  disabled,
  onSignIn,
  onDisconnect,
}: {
  binding: TargetBinding;
  /** A run is acting on the target now. */
  busy: boolean;
  /** Nothing can change: no service connection. */
  disabled: boolean;
  onSignIn: (binding: TargetBinding) => void;
  onDisconnect: (binding: TargetBinding) => void;
}) {
  const { t } = useTranslation('settings');
  const kind = t(`computer.targets.kind.${targetKind(binding)}`);
  const description = `${kind} · ${targetDetail(binding)}`;
  const menu = (
    <>
      {binding.kind === 'browser' && (
        <>
          <ItemMenuItem disabled={disabled} onSelect={() => onSignIn(binding)}>
            <LogIn />
            {t('computer.targets.signIn')}
          </ItemMenuItem>
          <ItemMenuSeparator />
        </>
      )}
      <ItemMenuItem
        variant="destructive"
        disabled={disabled}
        onSelect={() => onDisconnect(binding)}
      >
        <Unplug />
        {t('computer.targets.disconnect')}
      </ItemMenuItem>
    </>
  );
  return (
    <ItemContextMenu menu={menu}>
      <Item asChild size="sm" className="settings-card-row">
        <li>
          <ItemMedia variant="icon">
            <TargetIcon binding={binding} />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="min-w-0">
              <span className="truncate" title={binding.label}>
                {binding.label}
              </span>
              {busy && <Badge variant="secondary">{t('computer.targets.inUse')}</Badge>}
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
                  aria-label={t('computer.targets.moreFor', { name: binding.label })}
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
