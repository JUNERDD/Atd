import { useId, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia } from '@atd/ui/components/item';
import { Skeleton } from '@atd/ui/components/skeleton';
import { LoadingPlaceholder, TextPlaceholder } from '../../components/loading-placeholder';

/**
 * One group of an app's page (Versions, Widgets, Permissions, Data), laid out like the grouped
 * boxes of the General settings: the title (with an optional trailing control, such as Versions'
 * Show all), an optional notice, the rows in one `settings-card` whose hairlines divide them, and
 * a footnote under the card that explains the group. `children` are `Item` rows (`li`), an
 * `AppDetailRowsPlaceholder` while they load, or an `AppDetailStatusRow` when they could not.
 */
export function AppDetailSection({
  title,
  action,
  notice,
  footer,
  children,
}: {
  title: string;
  action?: ReactNode;
  notice?: ReactNode;
  footer?: string | undefined;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="app-detail-section" aria-labelledby={id}>
      <div className="app-detail-section-header">
        <h3 id={id} className="settings-section-title">
          {title}
        </h3>
        {action}
      </div>
      {notice}
      <Card size="sm" className="settings-card">
        <ItemGroup>{children}</ItemGroup>
      </Card>
      {footer && <p className="app-detail-footnote">{footer}</p>}
    </section>
  );
}

/**
 * A group's rows while they load: placeholder rows in the card, with the group's anatomy (an icon,
 * the title over its description, a trailing switch) at the rows' size, so the group keeps its
 * place and its rows take the placeholders' places. One `li` of the card's list holds them all, so
 * the list gains no nested list; the card's hairlines still divide them.
 */
export function AppDetailRowsPlaceholder({
  label,
  count = 3,
  media = false,
  trailing = 'none',
}: {
  /** What is loading, for assistive technology ("Loading versions…"). */
  label: string;
  count?: number;
  media?: boolean;
  trailing?: 'switch' | 'none';
}) {
  return (
    <li>
      <LoadingPlaceholder label={label}>
        {Array.from({ length: count }, (_, index) => (
          <Item key={index} size="sm" className="settings-card-row">
            {media && (
              <ItemMedia variant="icon">
                <Skeleton className="size-4 rounded-md" />
              </ItemMedia>
            )}
            <ItemContent>
              <TextPlaceholder width={index % 2 ? 'third' : 'quarter'} />
              <TextPlaceholder width={index % 2 ? 'half' : 'twoThirds'} />
            </ItemContent>
            {trailing === 'switch' && (
              <Skeleton className="ml-auto h-5 w-8 shrink-0 rounded-full" />
            )}
          </Item>
        ))}
      </LoadingPlaceholder>
    </li>
  );
}

/**
 * Why a group's rows could not be read, with Try again: one row in the card, so the group keeps
 * its place and shape until a retry brings its rows.
 */
export function AppDetailStatusRow({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useTranslation('apps');
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li>
        <ItemContent>
          <p className="settings-inline-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </p>
        </ItemContent>
        <ItemActions className="ml-auto">
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('panel.retry')}
          </Button>
        </ItemActions>
      </li>
    </Item>
  );
}
