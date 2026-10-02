import { useRef, useState, type ReactNode } from 'react';
import { Blocks, PackagePlus, Search, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PluginSummary } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { useCompositionQuery } from '@atd/ui/lib/ime';
import { showToast } from '../../components/toast-store';
import { SettingsHeading } from '../settings/settings-heading';
import { SettingsSearchField } from '../settings/settings-search-field';
import { ExtensionAddMenu, type PersonalCreateKind } from './extension-add-menu';
import { ExtensionLoadError } from './extension-detail-fields';
import { ExtensionGroup } from './extension-group';
import { McpApprovalNotice } from './mcp-approval-notice';
import { PluginItemGroups } from './plugin-item-groups';
import { PluginCard, PluginUninstallDialog } from './plugin-card';
import { PLUGIN_SECTIONS, pluginSection } from './plugin-rows';
import type { Extensions } from './use-extensions';
import type { ExtensionItemKind } from './use-extension-route';
import { usePluginMatches } from './use-extension-matches';
import type { PluginItemActions } from './use-plugin-item-actions';
import { usePluginLabels } from './use-plugin-labels';

/**
 * The Extensions list: every plugin as a card under Built-in, then Personal & shared (Personal,
 * the shared skills folder and every installed plugin), with search and the Add menu in the heading. A search spans the plugins and everything they
 * contribute, so the sections step aside for the matching plugins' cards, then each plugin's
 * matching items by kind. The heading and search stay above the scrolling list, which opens with
 * the one-time notice that MCP servers need approving until it is dismissed. Until the list has
 * plugins it says why: loading, a failed read (with Try again), a disconnected service, or none
 * installed; a failed later read keeps the cards and shows its error above them.
 */
export function ExtensionOverview({
  extensions,
  search,
  actions,
  onOpenPlugin,
  onOpenItem,
  onInstall,
  onUpdate,
  onCreate,
}: {
  extensions: Extensions;
  search: ReturnType<typeof useCompositionQuery>;
  actions: PluginItemActions;
  onOpenPlugin: (id: string, focus?: 'config') => void;
  onOpenItem: (pluginId: string, kind: ExtensionItemKind, name: string) => void;
  onInstall: () => void;
  onUpdate: (id: string) => void;
  onCreate: (kind: PersonalCreateKind) => void;
}) {
  const { t } = useTranslation('settings');
  const labels = usePluginLabels();
  const { connected, plugins, skills, agents, mcp, commands, busy, pluginMutations } = extensions;
  const [uninstalling, setUninstalling] = useState<PluginSummary | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const list = plugins.plugins ?? [];
  const agentRows = agents.agents?.agents ?? [];
  const groups = usePluginMatches(search.query, list, {
    commands,
    skills: skills.skills?.skills ?? [],
    agents: agentRows,
    mcp: mcp.mcp?.servers ?? [],
  });
  const searching = Boolean(search.query.trim());

  const card = (plugin: PluginSummary, match: (typeof groups)[number]['match'] = null) => (
    <PluginCard
      key={plugin.id}
      plugin={plugin}
      match={match}
      connected={connected}
      busy={busy?.kind === 'plugin' && busy.id === plugin.id}
      onOpen={() => onOpenPlugin(plugin.id)}
      onEnabled={(enabled) => extensions.setPluginEnabled(plugin.id, enabled)}
      onUpdate={() => onUpdate(plugin.id)}
      onConfigure={() => onOpenPlugin(plugin.id, 'config')}
      onUninstall={() => setUninstalling(plugin)}
    />
  );
  // The panel owns the scrollbar; the heading and search stay put above it.
  const scroll = (content: ReactNode) => (
    <ScrollArea
      className="settings-extension-scroll settings-page-scroll"
      viewportClassName="[&>div]:flex! [&>div]:flex-col [&>div]:min-h-full"
      gutter="none"
      scrollShadow
    >
      <div className="settings-extension-list">{content}</div>
    </ScrollArea>
  );

  const matched = groups.filter((group) => group.match);
  const results = groups.length ? (
    <div className="settings-extension-results">
      {matched.length ? (
        <ExtensionGroup
          title={t('extensions.plugins.resultsPlugins')}
          empty=""
          loading={false}
          hasRows
          cards
        >
          {matched.map((group) => card(group.plugin, group.match))}
        </ExtensionGroup>
      ) : null}
      {groups.map((group) => (
        <PluginItemGroups
          key={group.plugin.id}
          plugin={group.plugin}
          titlePrefix={labels.name(group.plugin)}
          items={group}
          agentRows={agentRows}
          connected={connected}
          busy={busy}
          mcpBusyId={mcp.busyId}
          mcpIssues={mcp.issues}
          actions={actions}
          onOpen={(kind, itemName) => onOpenItem(group.plugin.id, kind, itemName)}
        />
      ))}
    </div>
  ) : (
    <ExtensionGroup
      title={t('extensions.title')}
      empty={t('extensions.noMatchesTitle', { query: search.query.trim() })}
      emptyDescription={t('extensions.noMatchesDescription')}
      loading={plugins.loading}
      hasRows={false}
      showTitle={false}
      emptyIcon={<Search />}
      emptyAction={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            search.change('');
            searchRef.current?.focus();
          }}
        >
          {t('extensions.clearSearch')}
        </Button>
      }
    />
  );

  // Without plugins to list, the list says why; `loading` covers the connecting service too.
  const disconnected = extensions.serviceState === 'disconnected';
  const unlisted = plugins.error ? (
    <ExtensionLoadError
      message={t('extensions.plugins.loadFailed', { message: plugins.error })}
      onRetry={() => plugins.refresh()}
    />
  ) : (
    <ExtensionGroup
      title={t('extensions.title')}
      showTitle={false}
      loading={!disconnected && plugins.plugins === null}
      hasRows={false}
      empty={
        disconnected
          ? t('extensions.plugins.disconnectedTitle')
          : t('extensions.plugins.emptyTitle')
      }
      emptyDescription={
        disconnected
          ? t('extensions.plugins.disconnectedDescription')
          : t('extensions.plugins.emptyDescription')
      }
      emptyIcon={disconnected ? <Unplug /> : <Blocks />}
      emptyAction={
        disconnected ? null : (
          <Button type="button" variant="outline" size="sm" onClick={onInstall}>
            <PackagePlus data-icon="inline-start" />
            {t('extensions.plugins.installPlugin')}
          </Button>
        )
      }
    />
  );

  const sections = PLUGIN_SECTIONS.map((section) => {
    const rows = list.filter((plugin) => pluginSection(plugin) === section);
    // Built-in always holds Core and Personal & shared holds Personal once the list loads.
    if (!rows.length) return null;
    return (
      <ExtensionGroup
        key={section}
        title={t(`extensions.plugins.sections.${section}`)}
        empty=""
        loading={plugins.loading}
        hasRows
        cards
      >
        {rows.map((plugin) => card(plugin))}
      </ExtensionGroup>
    );
  });

  return (
    <section className="settings-extension-settings" aria-label={t('extensions.title')}>
      <SettingsHeading
        title={t('extensions.title')}
        description={t('extensions.plugins.description')}
      >
        <SettingsSearchField
          search={search}
          ref={searchRef}
          aria-label={t('extensions.searchLabel')}
          placeholder={t('extensions.plugins.searchPlaceholder')}
          disabled={!list.length}
        />
        <ExtensionAddMenu
          disabled={!connected || busy !== null}
          onInstall={onInstall}
          onCreate={onCreate}
        />
      </SettingsHeading>
      <div className="settings-extension-body">
        {scroll(
          <>
            {mcp.mcp?.approvalNotice ? (
              <McpApprovalNotice
                disabled={!connected}
                onDismiss={() => mcp.dismissApprovalNotice()}
              />
            ) : null}
            {list.length && plugins.error ? (
              <ExtensionLoadError
                message={t('extensions.plugins.loadFailed', { message: plugins.error })}
                onRetry={() => plugins.refresh()}
              />
            ) : null}
            {!list.length ? unlisted : searching ? results : sections}
          </>,
        )}
      </div>
      <PluginUninstallDialog
        name={uninstalling ? labels.name(uninstalling) : null}
        onCancel={() => setUninstalling(null)}
        onConfirm={() => {
          const target = uninstalling;
          setUninstalling(null);
          if (!target) return;
          void pluginMutations.uninstall(target.id).then((ok) => {
            if (!ok) return;
            showToast({
              kind: 'info',
              text: t('extensions.plugins.uninstalled', { name: labels.name(target) }),
            });
          });
        }}
      />
    </section>
  );
}
