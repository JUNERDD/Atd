import { useTranslation } from 'react-i18next';
import { useCompositionQuery } from '@atd/ui/lib/ime';
import { useMemoryCreate } from '../memory/use-memory-create';
import { showToast } from '../../components/toast-store';
import { useSettingsNavigation, useSettingsSectionExit } from '../settings/settings-navigation';
import type { PersonalCreateKind } from './extension-add-menu';
import { ExtensionItemRoute } from './extension-item-route';
import { ExtensionOverview } from './extension-overview';
import { PluginInstallPage } from './extension-plugin-install-page';
import { ExtensionPluginPage } from './extension-plugin-page';
import { useExtensionAiSession } from './use-extension-ai-session';
import { useExtensionRoute } from './use-extension-route';
import { useExtensions } from './use-extensions';
import { usePluginItemActions } from './use-plugin-item-actions';
import { usePluginLabels } from './use-plugin-labels';

/**
 * The Extensions settings section: plugins and what they contribute. The list, one plugin's page,
 * one item's page, the install page and the Personal add forms replace each other as pages of the
 * section's history (`useExtensionRoute`); commands and memory open their own sections. The search
 * text survives visiting a page and returning, and resets with the history when the section is
 * left.
 */
export function ServiceSettings() {
  const { t } = useTranslation('settings');
  const labels = usePluginLabels();
  const navigateSection = useSettingsNavigation();
  const search = useCompositionQuery();
  useSettingsSectionExit(() => search.change(''));
  const extensions = useExtensions();
  const { route, open, back, leave, replace, openItem } = useExtensionRoute(extensions);
  // A page's Cancel steps back through `back`, which first asks about an editor's unsaved changes.
  // A save, delete or uninstall leaves through `close` once it finishes: never asked, and only if
  // that page is still shown.
  const close = () => leave(route);
  const actions = usePluginItemActions(extensions);
  const startAi = useExtensionAiSession(extensions.skills.skills?.skills ?? []);
  const memoryCreate = useMemoryCreate();
  const { connected, locked, pluginMutations } = extensions;

  function create(kind: PersonalCreateKind) {
    if (kind === 'command') navigateSection('commands');
    else if (kind === 'memory') memoryCreate.start(null);
    else if (kind === 'skill') void startAi('skill', null);
    else open({ level: 'create', kind });
  }

  switch (route.level) {
    case 'list':
      return (
        <ExtensionOverview
          extensions={extensions}
          search={search}
          actions={actions}
          onOpenPlugin={(pluginId, focus) =>
            open({ level: 'plugin', pluginId, ...(focus ? { focus } : {}) })
          }
          onOpenItem={(pluginId, kind, name) => openItem({ pluginId, kind, name })}
          onInstall={() => open({ level: 'install' })}
          onUpdate={(updateOf) => open({ level: 'install', updateOf })}
          onCreate={create}
        />
      );
    case 'install': {
      const target = route.updateOf
        ? extensions.plugins.plugins?.find((plugin) => plugin.id === route.updateOf)
        : undefined;
      return (
        <PluginInstallPage
          key={route.updateOf ?? ''}
          updateOf={route.updateOf}
          updateName={target ? labels.name(target) : undefined}
          connected={connected}
          busy={locked}
          onBack={back}
          onPreview={pluginMutations.preview}
          onPreviewUpdate={pluginMutations.previewUpdate}
          onInstall={async (previewId) => {
            const result = await pluginMutations.install(previewId);
            if (!result.ok) return result;
            const { plugin } = result.value;
            const name = labels.name(plugin);
            showToast({
              kind: 'info',
              text: route.updateOf
                ? t('extensions.plugins.install.updated', { name })
                : t('extensions.plugins.install.installed', { name }),
            });
            replace({ level: 'plugin', pluginId: plugin.id }, route);
            return result;
          }}
        />
      );
    }
    case 'plugin':
      return (
        <ExtensionPluginPage
          key={route.pluginId}
          pluginId={route.pluginId}
          focus={route.focus}
          extensions={extensions}
          actions={actions}
          onBack={close}
          onOpenItem={(kind, name) => open({ level: 'item', pluginId: route.pluginId, kind, name })}
          onUpdate={() => open({ level: 'install', updateOf: route.pluginId })}
        />
      );
    case 'item':
    case 'create':
      return (
        <ExtensionItemRoute
          route={route}
          extensions={extensions}
          onBack={back}
          onLeave={close}
          onOpenItem={openItem}
          onStartAi={(kind, target) => void startAi(kind, target)}
        />
      );
    default: {
      const _exhaustive: never = route;
      return _exhaustive;
    }
  }
}
