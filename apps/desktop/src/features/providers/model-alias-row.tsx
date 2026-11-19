import { Check, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModelAlias } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { HighlightedText } from '@atd/ui/components/highlighted-text';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@atd/ui/components/item';
import type { MatchRange } from '@atd/ui/lib/fuzzy-match';
import type { Connection } from '../../client/providers/schema';
import { IconButton } from '../../components/icon-button';
import { ItemContextMenu, ItemMenuItem, ItemMenuSeparator } from '../../components/item-menu';
import { formatAliasTupleSummary } from '../agent/use-panel-aliases';
import { ProviderBrand } from './provider-brand';
import { providerPresentation } from './provider-services';
import '../../components/open-row.css';

interface ModelAliasRowProps {
  alias: ModelAlias;
  connection: Connection | undefined;
  catalogModel: Connection['catalog'][number] | undefined;
  nameRanges?: readonly MatchRange[] | undefined;
  isDefault: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggleDefault: () => void;
  onDelete: () => void;
}

/** One saved model alias row with edit, default toggle, and delete actions. */
export function ModelAliasRow({
  alias,
  connection,
  catalogModel,
  nameRanges,
  isDefault,
  busy,
  onEdit,
  onToggleDefault,
  onDelete,
}: ModelAliasRowProps) {
  const { t } = useTranslation('providers');
  const presentation = connection ? providerPresentation(connection) : null;
  const available = Boolean(connection?.connected && catalogModel);
  const connectionName = connection?.name ?? t('aliases.unavailableConnection');
  const tuple = [
    connectionName,
    formatAliasTupleSummary(alias, connection ? [connection] : [], t),
  ].join(' · ');

  const menu = (
    <>
      <ItemMenuItem disabled={busy} onSelect={onEdit}>
        <Pencil aria-hidden="true" />
        {t('aliases.actions.edit')}
      </ItemMenuItem>
      <ItemMenuItem disabled={busy} onSelect={onToggleDefault}>
        <Check aria-hidden="true" />
        {isDefault ? t('aliases.actions.clearDefault') : t('aliases.actions.setDefault')}
      </ItemMenuItem>
      <ItemMenuSeparator />
      <ItemMenuItem variant="destructive" disabled={busy} onSelect={onDelete}>
        <Trash2 aria-hidden="true" />
        {t('aliases.actions.delete')}
      </ItemMenuItem>
    </>
  );

  return (
    <ItemContextMenu menu={menu}>
      <Item asChild size="sm" variant="outline" className="open-row provider-connection-row">
        <li>
          <button
            type="button"
            className="open-row-button"
            aria-label={t('aliases.actions.editFor', { name: alias.name })}
            disabled={busy}
            onClick={onEdit}
          />
          <div className="provider-identity">
            <ProviderBrand
              provider={presentation?.service.brand ?? connection?.provider ?? 'openai-compatible'}
            />
            <ItemContent>
              <div className="provider-name-track">
                <ItemTitle className="min-w-0" title={alias.name}>
                  <HighlightedText text={alias.name} ranges={nameRanges} />
                </ItemTitle>
                {isDefault && <Badge variant="secondary">{t('connections.defaultBadge')}</Badge>}
                {!available && <Badge variant="outline">{t('aliases.unavailableBadge')}</Badge>}
              </div>
              <ItemDescription className="whitespace-normal">{tuple}</ItemDescription>
            </ItemContent>
          </div>
          <ItemActions className="model-alias-actions">
            <Button type="button" variant="outline" size="xs" disabled={busy} onClick={onEdit}>
              {t('aliases.actions.edit')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  label={t('connections.more')}
                  aria-label={t('aliases.actionsLabel', { name: alias.name })}
                  disabled={busy}
                  tooltip={false}
                >
                  <Ellipsis />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4} collisionPadding={8}>
                {menu}
              </DropdownMenuContent>
            </DropdownMenu>
          </ItemActions>
        </li>
      </Item>
    </ItemContextMenu>
  );
}
