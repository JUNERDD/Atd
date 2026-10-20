import { useState, type ReactNode } from 'react';
import { Download, MoreHorizontal, Puzzle, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
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
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { Skeleton } from '@atd/ui/components/skeleton';
import { Spinner } from '@atd/ui/components/spinner';
import { IconButton } from '../../components/icon-button';
import { ItemContextMenu, ItemMenuItem } from '../../components/item-menu';
import { ExtensionRemoveDialog } from '../service/extension-remove-dialog';
import { AddonDetail } from './addon-detail';
import { AddonFailureNotice } from './addon-failure-notice';
import { useAddonCard } from './use-addon-card';

/**
 * One add-on (an optional download) as a row of a settings card. The caller names it: `id` picks
 * the add-on from the service's list, `title` and `description` say what it adds. The row follows
 * the add-on through its states and keeps the action in one place:
 * not installed → Install; downloading, verifying or installing → status (and a progress bar for
 * a download) with Cancel; installed → its version and a More menu with Remove, which asks first;
 * an older archive after an app update → Update, with the same More menu; a failed install or removal → the reason under
 * the row, retried with its Install or Update; not offered in this build → said
 * in place of the action. Rows belong in an `AddonCardGroup`.
 */
export function AddonCard({
  id,
  title,
  description,
  icon = <Puzzle />,
}: {
  id: string;
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  const { t } = useTranslation('addons');
  const card = useAddonCard(id);
  const [confirming, setConfirming] = useState(false);
  const { state, failure } = card;
  const installing = card.pending === 'install';

  // An outdated archive is removable too: it may never be replaced (a build without it, a failing
  // update), and its files should not be stuck on the Mac.
  const removable =
    card.addon?.phase === 'idle' && Boolean(card.addon.installed || card.addon.outdated);
  const menu = removable ? (
    <ItemMenuItem
      variant="destructive"
      disabled={card.disabled}
      onSelect={() => setConfirming(true)}
    >
      <Trash2 />
      {t('actions.remove')}
    </ItemMenuItem>
  ) : null;

  const install = (label: string, Icon: typeof Download) => (
    <Button type="button" disabled={card.disabled} onClick={card.install}>
      {installing ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" />}
      {label}
    </Button>
  );

  let action: ReactNode = null;
  if (state === 'loading') {
    action = card.loadError ? (
      <Button type="button" variant="outline" onClick={card.retry}>
        {t('actions.tryAgain')}
      </Button>
    ) : (
      <Skeleton className="h-8 w-20" />
    );
  } else if (state === 'unavailable') {
    action = <Badge variant="outline">{t('unavailable')}</Badge>;
  } else if (state === 'notInstalled') {
    action = install(t('actions.install'), Download);
  } else if (state === 'outdated') {
    action = install(t('actions.update'), RefreshCw);
  } else if (state === 'working' && card.addon?.phase !== 'removing') {
    action = (
      <Button type="button" variant="outline" disabled={card.disabled} onClick={card.cancel}>
        {t('actions.cancel')}
      </Button>
    );
  }
  const more = menu ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={t('actions.more')}
          aria-label={t('actions.moreFor', { name: title })}
          tooltipDismissOnClick
        >
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  // The row's own Install or Update is the way to try again, so the notice only explains.
  const notice = failure ? (
    <AddonFailureNotice code={failure.code} message={failure.message} />
  ) : card.requestError ? (
    <AddonFailureNotice code="request" message={card.requestError} />
  ) : null;

  return (
    <>
      <ItemContextMenu menu={menu}>
        <Item asChild size="sm" className="settings-card-row">
          <li aria-busy={state === 'working' || undefined}>
            <ItemMedia variant="icon">{icon}</ItemMedia>
            <ItemContent className="min-w-[min(12rem,100%)]">
              <ItemTitle className="min-w-0">
                <span className="truncate" title={title}>
                  {title}
                </span>
              </ItemTitle>
              <ItemDescription className="whitespace-normal">{description}</ItemDescription>
              <AddonDetail state={state} addon={card.addon} loadError={card.loadError} />
            </ItemContent>
            <ItemActions className="shrink-0">
              {action}
              {more}
            </ItemActions>
            {notice ? <div className="basis-full">{notice}</div> : null}
          </li>
        </Item>
      </ItemContextMenu>
      <ExtensionRemoveDialog
        name={confirming ? id : null}
        title={t('remove.title', { name: title })}
        description={t('remove.description')}
        confirm={t('actions.remove')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          card.remove();
        }}
      />
    </>
  );
}

/** The card that holds add-on rows: one frame, hairlines between the rows. */
export function AddonCardGroup({
  label,
  children,
}: {
  /** The group's accessible name. */
  label: string;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="settings-card">
      <ItemGroup aria-label={label}>{children}</ItemGroup>
    </Card>
  );
}
