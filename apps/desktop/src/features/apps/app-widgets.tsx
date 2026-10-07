import { useQuery } from '@tanstack/react-query';
import { ImageOff, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WidgetDecl, WidgetFamily } from '@atd/agent-contracts';
import { Alert, AlertDescription } from '@atd/ui/components/alert';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@atd/ui/components/item';
import { queryClient } from '../../lib/query-client';
import { useSettingsSnapshot } from '../settings/use-settings';
import { AppDetailSection } from './app-detail-group';
import { appKeys, appsBridge } from './use-apps';
import './apps.css';

/** Smallest first: a widget's preview shows the smallest size it declares. */
const FAMILY_ORDER: readonly WidgetFamily[] = ['systemSmall', 'systemMedium', 'systemLarge'];

/**
 * The widget as the desktop draws it, which the shell renders from the latest synced snapshot.
 * It has none until the widget first rendered (or the snapshot failed validation), so a rejected
 * preview reads as pending, not as an error. Keyed on the app's build revision, since any build,
 * an in-place one of the current version included, may change the widget.
 */
function useWidgetPreview(appId: string, widgetId: string, family: WidgetFamily, revision: number) {
  const { data, isError } = useQuery(
    {
      queryKey: [...appKeys.all, 'widgetPreview', appId, widgetId, family, revision],
      queryFn: () => appsBridge().widgetPreview(appId, widgetId, family),
      enabled: Boolean(window.desktop?.apps),
      meta: { errorToast: false },
    },
    queryClient,
  );
  return { src: data ?? null, pending: isError || !window.desktop?.apps };
}

/**
 * One declared widget (Figma `App / App widget row · Rhea`): a 56px preview of its smallest size,
 * its title and description, and the sizes it offers with how often it refreshes, or "No preview
 * yet" while the shell has no snapshot. No actions: widgets are added from the macOS widget
 * gallery, as the group's footnote says.
 */
function AppWidgetRow({
  appId,
  revision,
  widget,
}: {
  appId: string;
  revision: number;
  widget: WidgetDecl;
}) {
  const { t } = useTranslation('apps');
  const families = FAMILY_ORDER.filter((family) => widget.families.includes(family));
  const preview = useWidgetPreview(appId, widget.id, families[0] ?? 'systemSmall', revision);
  const sizes = families.map((family) => t(`detail.widgets.family.${family}`)).join(' · ');
  const status = preview.pending
    ? t('detail.widgets.noPreview')
    : t('detail.widgets.refreshes', { count: widget.refreshMinutes });
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li>
        <ItemMedia>
          <span className="app-icon-tile flex size-14 items-center justify-center overflow-hidden rounded-xl bg-input/40 text-muted-foreground">
            {preview.src ? (
              <img
                src={preview.src}
                alt={t('detail.widgets.previewAlt', { name: widget.title })}
                className="size-full object-cover"
              />
            ) : (
              <ImageOff aria-hidden="true" className="size-4.5" />
            )}
          </span>
        </ItemMedia>
        <ItemContent className="min-w-[min(120px,100%)]">
          <ItemTitle className="whitespace-normal">{widget.title}</ItemTitle>
          {widget.description && (
            <ItemDescription className="line-clamp-2 whitespace-normal">
              {widget.description}
            </ItemDescription>
          )}
          <p className="app-detail-meta">{`${sizes} · ${status}`}</p>
        </ItemContent>
      </li>
    </Item>
  );
}

/**
 * The widgets the current version declares, with how to add them as the footnote. While Atd runs
 * outside the Applications folder macOS cannot configure its widgets
 * (`app.state.widgetsAvailable`), which a warning notice above the rows says (Figma
 * `App / App widgets unavailable notice · Rhea`).
 */
export function AppWidgetsSection({
  appId,
  appName,
  revision,
  widgets,
}: {
  appId: string;
  appName: string;
  /** The app's build revision (`AppSummary.revision`), which keys the previews. */
  revision: number;
  widgets: readonly WidgetDecl[];
}) {
  const { t } = useTranslation('apps');
  const available = useSettingsSnapshot().snapshot?.widgetsAvailable ?? true;
  return (
    <AppDetailSection
      title={t('detail.widgets.title')}
      footer={t('detail.widgets.footer', { name: appName })}
      notice={
        !available && (
          <Alert className="app-widgets-notice bg-transparent">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription className="text-xs">
              {t('detail.widgets.unavailable')}
            </AlertDescription>
          </Alert>
        )
      }
    >
      {widgets.map((widget) => (
        <AppWidgetRow key={widget.id} appId={appId} revision={revision} widget={widget} />
      ))}
    </AppDetailSection>
  );
}
