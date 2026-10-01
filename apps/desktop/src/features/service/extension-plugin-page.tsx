import { useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PluginDetail, PluginSummary } from '@ai/agent-contracts';
import { Alert, AlertAction, AlertDescription } from '@ai/ui/components/alert';
import { Button } from '@ai/ui/components/button';
import { Switch } from '@ai/ui/components/switch';
import { showToast } from '../../components/toast-store';
import {
  ExtensionDetailFields,
  ExtensionDetailStatus,
  type DetailField,
} from './extension-detail-fields';
import { ExtensionPage } from './extension-page';
import { PluginConfigForm } from './plugin-config-form';
import { PluginDiagnostics } from './plugin-diagnostics';
import { PluginItemTabs } from './plugin-item-tabs';
import { PluginBadges, PluginUninstallDialog } from './plugin-card';
import { pluginKindRows, pluginSourceBadge, pluginSourceText } from './plugin-rows';
import type { Extensions } from './use-extensions';
import { useExtensionMatches } from './use-extension-matches';
import type { ExtensionItemKind } from './use-extension-route';
import type { PluginItemActions } from './use-plugin-item-actions';
import { usePluginDetail } from './use-plugin-detail';
import { usePluginLabels } from './use-plugin-labels';

/** Where an installed plugin came from, what it is, and when it arrived. */
function useMetadata(plugin: PluginSummary | null, detail: PluginDetail | null): DetailField[] {
  const { t, i18n } = useTranslation('settings');
  const labels = usePluginLabels();
  if (!plugin) return [];
  const badge = pluginSourceBadge(plugin);
  const pinned = detail?.resolved?.commit ?? detail?.resolved?.version;
  const installedAt = plugin.installedAt ? new Date(plugin.installedAt) : null;
  const fields: (DetailField | null)[] = [
    badge
      ? {
          label: t('extensions.plugins.page.source'),
          value: plugin.source ? pluginSourceText(plugin.source) : labels.source(badge),
          mono: Boolean(plugin.source),
        }
      : null,
    plugin.version ? { label: t('extensions.plugins.page.version'), value: plugin.version } : null,
    plugin.format
      ? {
          label: t('extensions.plugins.page.format'),
          value: t(`extensions.plugins.format.${plugin.format}`),
        }
      : null,
    plugin.revision
      ? { label: t('extensions.plugins.page.revision'), value: plugin.revision, mono: true }
      : null,
    pinned ? { label: t('extensions.plugins.page.pinned'), value: pinned, mono: true } : null,
    plugin.license ? { label: t('extensions.plugins.page.license'), value: plugin.license } : null,
    installedAt && !Number.isNaN(installedAt.getTime())
      ? {
          label: t('extensions.plugins.page.installedAt'),
          value: installedAt.toLocaleString(i18n.resolvedLanguage),
        }
      : null,
  ];
  return fields.filter((field) => field !== null);
}

/**
 * One plugin's page: its switch and version in the heading, where it came from, then what it
 * contributes in one tab per kind (Commands, Skills, Subagents, MCP servers, and Personal's Memory), what could not be
 * imported, and its configuration. A newly installed plugin is off, so its page offers to turn it
 * on. Items of a plugin that is off keep their own switches, locked until the plugin is on.
 */
export function ExtensionPluginPage({
  pluginId,
  focus,
  extensions,
  actions,
  onBack,
  onOpenItem,
  onUpdate,
}: {
  pluginId: string;
  focus?: 'config';
  extensions: Extensions;
  actions: PluginItemActions;
  onBack: () => void;
  onOpenItem: (kind: ExtensionItemKind, name: string) => void;
  onUpdate: () => void;
}) {
  const { t } = useTranslation('settings');
  const labels = usePluginLabels();
  const { connected, busy, pluginMutations } = extensions;
  const {
    loaded,
    replace,
    setItemEnabled: patchItem,
    retry,
  } = usePluginDetail(pluginId, extensions.epoch);
  const [uninstalling, setUninstalling] = useState(false);
  const detail = loaded && 'detail' in loaded ? loaded.detail : null;
  const listed = extensions.plugins.plugins?.find((plugin) => plugin.id === pluginId);
  // The list row carries a switch change before the service answers it.
  const plugin = detail
    ? { ...detail.plugin, enabled: listed?.enabled ?? detail.plugin.enabled }
    : (listed ?? null);
  const kindRows = pluginKindRows(detail?.items ?? [], plugin?.origin ?? 'host', {
    skills: extensions.skills.skills?.skills ?? [],
    agents: extensions.agents.agents?.agents ?? [],
    mcp: extensions.mcp.mcp?.servers ?? [],
  });
  // Personal commands are addressed by id (`name`, with `title` their display name); a plugin's
  // by its qualified name. The agent snapshot adds the command's icon.
  const commands = (detail?.items ?? [])
    .filter((item) => item.kind === 'command')
    .map((item) => {
      const known = extensions.commands.find(
        (command) =>
          command.pluginId === pluginId && (command.id === item.name || command.name === item.name),
      );
      return {
        pluginId,
        itemName: item.name,
        id: known?.id ?? null,
        name: known?.name ?? item.title ?? item.localName,
        description: known?.description ?? item.description,
        // The detail carries the switch; the snapshot follows once the service tells the app.
        enabled: item.itemEnabled,
        templateId: known?.templateId ?? null,
      };
    });
  const items = useExtensionMatches('', { ...kindRows, commands });
  const metadata = useMetadata(plugin, detail);
  const pluginBusy = busy?.kind === 'plugin' && busy.id === pluginId;
  const locked = !connected || pluginBusy;
  const name = plugin ? labels.name(plugin) : pluginId;
  const backLabel = t('extensions.plugins.page.back');

  if (!plugin || !detail) {
    const failed = loaded && 'error' in loaded ? loaded.error : null;
    return (
      <ExtensionPage label={name} title={name} backLabel={backLabel}>
        <ExtensionDetailStatus
          text={failed ?? t('extensions.detailLoading')}
          error={failed !== null}
          onRetry={retry}
        />
      </ExtensionPage>
    );
  }

  const setEnabled = (enabled: boolean) => extensions.setPluginEnabled(plugin.id, enabled, replace);
  // Personal holds the one memory item; the Memory section owns its switch, the learning pause.
  const memory = detail.items.find((item) => item.kind === 'memory');
  const hasItems =
    items.commands.length + items.skills.length + items.agents.length + items.mcp.length > 0 ||
    Boolean(memory);
  const installed = plugin.origin === 'installed';

  return (
    <ExtensionPage
      label={t('extensions.plugins.page.label')}
      title={name}
      titleExtra={
        <>
          {plugin.version ? (
            <span className="shrink-0 text-sm text-muted-foreground">
              {t('extensions.plugins.page.versionLabel', { version: plugin.version })}
            </span>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <PluginBadges plugin={plugin} />
            {plugin.toggleable ? (
              <Switch
                aria-label={t('extensions.enableFor', { name })}
                aria-disabled={pluginBusy || undefined}
                aria-busy={pluginBusy || undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                checked={plugin.enabled}
                disabled={!connected}
                onCheckedChange={(enabled) => {
                  if (!pluginBusy) setEnabled(enabled);
                }}
              />
            ) : null}
          </div>
        </>
      }
      description={labels.description(plugin) || t('extensions.detailNoDescription')}
      backLabel={backLabel}
      actions={
        installed && (plugin.updatable || plugin.removable) ? (
          <>
            {plugin.removable ? (
              <Button
                type="button"
                variant="glass"
                disabled={locked}
                onClick={() => setUninstalling(true)}
              >
                <Trash2 data-icon="inline-start" />
                {t('extensions.plugins.uninstall')}
              </Button>
            ) : null}
            {plugin.updatable ? (
              <Button type="button" disabled={locked} onClick={onUpdate}>
                <RefreshCw data-icon="inline-start" />
                {t('extensions.plugins.update')}
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {installed && !plugin.enabled ? (
        <Alert>
          <AlertDescription>{t('extensions.plugins.page.enablePrompt', { name })}</AlertDescription>
          <AlertAction>
            <Button type="button" size="sm" disabled={locked} onClick={() => setEnabled(true)}>
              {t('extensions.plugins.page.enable')}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      <ExtensionDetailFields fields={metadata} />
      {detail.items.some((item) => item.readOnly && item.kind !== 'memory') ? (
        <p className="settings-field-note">{t('extensions.plugins.page.readOnlyNote')}</p>
      ) : null}
      <PluginItemTabs
        plugin={plugin}
        items={items}
        agentRows={extensions.agents.agents?.agents ?? []}
        connected={connected}
        busy={busy}
        mcpBusyId={extensions.mcp.busyId}
        mcpIssues={extensions.mcp.issues}
        detailItems={detail.items}
        actions={actions}
        onOpen={onOpenItem}
        onPatch={patchItem}
        memory={Boolean(memory)}
      />
      {!hasItems ? (
        <ExtensionDetailStatus text={t('extensions.plugins.page.noItems')} error={false} />
      ) : null}
      <PluginDiagnostics
        label={t('extensions.plugins.page.diagnostics')}
        diagnostics={plugin.diagnostics}
      />
      {detail.userConfig.length ? (
        <PluginConfigForm
          key={`${plugin.id}\n${plugin.revision ?? ''}`}
          detail={detail}
          disabled={!connected}
          pending={pluginBusy}
          focus={focus === 'config'}
          onSave={async (values) => {
            const result = await pluginMutations.configure(plugin.id, values);
            if (result.ok) replace(result.value);
            return result;
          }}
        />
      ) : null}
      <PluginUninstallDialog
        name={uninstalling ? name : null}
        onCancel={() => setUninstalling(false)}
        onConfirm={() => {
          setUninstalling(false);
          void pluginMutations.uninstall(plugin.id).then((ok) => {
            if (!ok) return;
            showToast({ kind: 'info', text: t('extensions.plugins.uninstalled', { name }) });
            extensions.refreshAll();
            onBack();
          });
        }}
      />
    </ExtensionPage>
  );
}
