import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Ellipsis, Pencil, SquareArrowOutUpRight, SquarePen, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppDetail, AppSummary } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Card, CardContent } from '@atd/ui/components/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { Spinner } from '@atd/ui/components/spinner';
import { IconButton } from '../../components/icon-button';
import { useAgent } from '../agent/use-agent';
import { AppIcon } from './app-icon';
import type { AppIntent } from './use-app-intent';
import './apps.css';

/** Whether the element's line clamp cuts its text off, measured again whenever it resizes. */
function useClamped(ref: RefObject<HTMLElement | null>, text: string) {
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // The observer reports the size once on observing, then on every change.
    const observer = new ResizeObserver(() =>
      setClamped(element.scrollHeight > element.clientHeight + 1),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, text]);
  return clamped;
}

/**
 * The top of an app's page, like a pane banner in System Settings: the app's 64px icon, its name
 * and description, its version, when it was created and the task that built it, then what to do
 * with it. Open is the one filled action; Continue editing and More (Rename, Delete) follow in the
 * order the panel's app cards use. When the app names an accent color (`accentColor`, a validated
 * `#RRGGBB` from its manifest) the card takes a faint wash of it; otherwise it stays neutral.
 * From 480px of page width the name, details and actions share the column beside the icon;
 * below it the name stays beside the icon and the details and actions take the card's full width
 * (apps.css). A long description stays clamped to three lines until Show more.
 */
export function AppDetailHero({
  app,
  detail,
  busy,
  pending,
  onOpen,
  onEdit,
  onRename,
  onDelete,
}: {
  /** The app as the list has it, shown until its details load. */
  app: AppSummary;
  detail: AppDetail | null;
  busy: boolean;
  pending: AppIntent | null;
  onOpen: () => void;
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation('apps');
  const { t: tSettings } = useTranslation('settings');
  const tasks = useAgent().snapshot?.tasks;
  const shown = detail ?? app;
  const description = shown.description.trim();
  const created = new Date(app.createdAt).toLocaleDateString(i18n.language, {
    dateStyle: 'medium',
  });
  const source = detail && tasks?.find(({ id }) => id === detail.sourceTaskId)?.title;
  const accent = shown.accentColor;
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const clamped = useClamped(descriptionRef, description);
  return (
    <Card
      size="sm"
      className="app-detail-hero"
      // The app's own color, as data: apps.css mixes it into the card's wash.
      style={accent ? ({ '--app-accent': accent } as CSSProperties) : undefined}
      data-accent={accent ? '' : undefined}
    >
      <CardContent className="app-detail-hero-layout">
        <AppIcon
          appId={app.id}
          version={shown.currentVersion}
          size="lg"
          className="app-detail-hero-icon"
        />
        <h2 className="app-detail-hero-name" title={shown.name}>
          {shown.name}
        </h2>
        <div className="app-detail-hero-body">
          {description && (
            <p
              ref={descriptionRef}
              className="app-detail-hero-description"
              data-expanded={expanded || undefined}
            >
              {description}
            </p>
          )}
          {description && (clamped || expanded) && (
            <Button
              type="button"
              variant="link"
              size="xs"
              className="app-detail-hero-more"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded
                ? tSettings('extensions.descriptionLess')
                : tSettings('extensions.descriptionMore')}
            </Button>
          )}
          <p className="app-detail-meta">
            {t('detail.meta', { version: shown.currentVersion, date: created })}
          </p>
          {source && <p className="app-detail-meta">{t('detail.builtIn', { task: source })}</p>}
        </div>
        <div className="app-detail-hero-actions">
          <Button
            type="button"
            aria-disabled={busy || undefined}
            aria-busy={pending === 'open' || undefined}
            onClick={onOpen}
          >
            {pending === 'open' ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SquareArrowOutUpRight data-icon="inline-start" />
            )}
            {t('panel.open')}
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-disabled={busy || undefined}
            aria-busy={pending === 'edit' || undefined}
            onClick={onEdit}
          >
            {pending === 'edit' ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SquarePen data-icon="inline-start" />
            )}
            {t('panel.edit')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={t('panel.more')}
                aria-label={t('panel.moreLabel', { name: shown.name })}
                variant="outline"
                size="icon"
                tooltipDismissOnClick
              >
                <Ellipsis />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={onRename}>
                  <Pencil />
                  {t('panel.rename')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" disabled={busy} onSelect={onDelete}>
                  <Trash2 />
                  {t('panel.delete')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
