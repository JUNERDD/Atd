import { Blocks, Box, FolderSymlink, RefreshCw, Settings2, Trash2, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PluginSummary } from '@ai/agent-contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@ai/ui/components/alert-dialog';
import { Badge } from '@ai/ui/components/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@ai/ui/components/card';
import { DropdownMenuItem, DropdownMenuSeparator } from '@ai/ui/components/dropdown-menu';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { ItemMedia } from '@ai/ui/components/item';
import type { FieldsMatch } from '@ai/ui/lib/fuzzy-match';
import { ExtensionRowActions } from './extension-row';
import { USER_PLUGIN_ID, pluginSourceBadge } from './plugin-rows';
import { usePluginLabels } from './use-plugin-labels';

/** The icon a plugin shows: what the host plugins are, or a bundle for installed ones. */
export function PluginIcon({ plugin }: { plugin: Pick<PluginSummary, 'id' | 'origin'> }) {
  if (plugin.origin === 'installed') return <Blocks />;
  if (plugin.id === USER_PLUGIN_ID) return <UserRound />;
  return plugin.id.startsWith('builtin:') ? <Box /> : <FolderSymlink />;
}

/** What keeps a plugin from working: it needs configuration, or it is turned off. */
export function PluginStateBadges({ plugin }: { plugin: PluginSummary }) {
  const { t } = useTranslation('settings');
  return (
    <>
      {plugin.needsConfig ? (
        <Badge variant="secondary">{t('extensions.plugins.needsConfig')}</Badge>
      ) : null}
      {plugin.toggleable && !plugin.enabled ? (
        <Badge variant="secondary">{t('extensions.plugins.disabled')}</Badge>
      ) : null}
    </>
  );
}

/** Badges beside a plugin's name on its page: where it comes from, then its state. */
export function PluginBadges({ plugin }: { plugin: PluginSummary }) {
  const labels = usePluginLabels();
  const source = pluginSourceBadge(plugin);
  return (
    <>
      {source ? <Badge variant="outline">{labels.source(source)}</Badge> : null}
      <PluginStateBadges plugin={plugin} />
    </>
  );
}

/**
 * One plugin in the Extensions list, as a card: its icon and name (with the source and version of
 * an installed plugin) over the description, and what it contributes at the foot beside what
 * keeps it from working. The switch (unless the plugin cannot be turned off) and More, when the
 * plugin has Update, Configure or Uninstall, sit at the top right. A click anywhere else on the
 * card (and More › View details) opens the plugin's page; the open button fills the card beneath
 * its content, as on the shared rows (`.settings-open-row`).
 */
export function PluginCard({
  plugin,
  match = null,
  connected,
  busy,
  onOpen,
  onEnabled,
  onUpdate,
  onConfigure,
  onUninstall,
}: {
  plugin: PluginSummary;
  /** Where a search marked the name and description. */
  match?: FieldsMatch<'name' | 'description'> | null;
  connected: boolean;
  /** A write for this plugin is running. */
  busy: boolean;
  onOpen: () => void;
  onEnabled: (enabled: boolean) => void;
  onUpdate: () => void;
  onConfigure: () => void;
  onUninstall: () => void;
}) {
  const { t } = useTranslation('settings');
  const labels = usePluginLabels();
  const name = labels.name(plugin);
  const description = labels.description(plugin);
  const contents = labels.contents(plugin.counts);
  // The section already says where a host plugin comes from; an installed one names its source
  // and version.
  const badge = plugin.origin === 'installed' ? pluginSourceBadge(plugin) : null;
  const source = [
    badge ? labels.source(badge) : '',
    badge && plugin.version
      ? t('extensions.plugins.page.versionLabel', { version: plugin.version })
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const locked = !connected || busy;
  const menu = plugin.updatable || plugin.needsConfig || plugin.removable;
  return (
    <li className="plugin-card-cell">
      <Card size="sm" className="plugin-card settings-open-row dark:bg-input/40">
        <button
          type="button"
          className="settings-open-row-button"
          aria-label={t('extensions.viewDetailsFor', { name })}
          onClick={onOpen}
        />
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            <ItemMedia variant="icon">
              <PluginIcon plugin={plugin} />
            </ItemMedia>
            <div className="min-w-0">
              <CardTitle className="truncate text-sm" title={name}>
                <HighlightedText text={name} ranges={match?.ranges.name} />
              </CardTitle>
              {source ? (
                <p className="truncate text-xs text-muted-foreground" title={source}>
                  {source}
                </p>
              ) : null}
            </div>
          </div>
          <CardAction>
            <ExtensionRowActions
              name={name}
              enabled={plugin.enabled}
              disabled={!connected}
              pending={busy}
              showSwitch={plugin.toggleable}
              reserveMore={false}
              onEnabledChange={onEnabled}
              onDetails={onOpen}
              menu={
                menu ? (
                  <PluginMenu
                    plugin={plugin}
                    locked={locked}
                    {...{ onUpdate, onConfigure, onUninstall }}
                  />
                ) : null
              }
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="plugin-card-description text-muted-foreground" title={description}>
            {description ? (
              <HighlightedText text={description} ranges={match?.ranges.description} />
            ) : (
              t('extensions.detailNoDescription')
            )}
          </p>
        </CardContent>
        <CardFooter className="plugin-card-footer">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={contents}>
            {contents}
          </span>
          <PluginStateBadges plugin={plugin} />
        </CardFooter>
      </Card>
    </li>
  );
}

/** More's plugin actions: Update, Configure, then Uninstall apart from them. */
function PluginMenu({
  plugin,
  locked,
  onUpdate,
  onConfigure,
  onUninstall,
}: {
  plugin: PluginSummary;
  locked: boolean;
  onUpdate: () => void;
  onConfigure: () => void;
  onUninstall: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <>
      {plugin.updatable ? (
        <DropdownMenuItem disabled={locked} onSelect={onUpdate}>
          <RefreshCw />
          {t('extensions.plugins.update')}
        </DropdownMenuItem>
      ) : null}
      {plugin.needsConfig ? (
        <DropdownMenuItem onSelect={onConfigure}>
          <Settings2 />
          {t('extensions.plugins.configure')}
        </DropdownMenuItem>
      ) : null}
      {plugin.removable ? (
        <>
          {plugin.updatable || plugin.needsConfig ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem variant="destructive" disabled={locked} onSelect={onUninstall}>
            <Trash2 />
            {t('extensions.plugins.uninstall')}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

/** Confirms uninstalling a plugin; `name` null keeps the dialog closed. */
export function PluginUninstallDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <AlertDialog
      open={name !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('extensions.plugins.uninstallTitle', { name: name ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('extensions.plugins.uninstallDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('extensions.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {t('extensions.plugins.uninstall')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
