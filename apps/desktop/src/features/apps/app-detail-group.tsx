import { useId, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import { Item, ItemActions, ItemContent, ItemGroup } from '@atd/ui/components/item';

/**
 * One group of an app's page (Versions, Widgets, Permissions, Data), laid out like the grouped
 * boxes of the General settings: the title (with an optional trailing control, such as Versions'
 * Show all), an optional notice, the rows in one `settings-card` whose hairlines divide them, and
 * a footnote under the card that explains the group. `children` are `Item` rows (`li`), or an
 * `AppDetailStatusRow` while they load.
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
 * A group's rows while they load, or why they could not, with Try again: one row in the card, so
 * the group keeps its place and shape until its rows arrive.
 */
export function AppDetailStatusRow({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation('apps');
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li>
        <ItemContent>
          {error ? (
            <p className="settings-inline-error" role="alert">
              <CircleAlert aria-hidden="true" />
              <span>{error}</span>
            </p>
          ) : (
            <output className="text-sm text-muted-foreground">{t('detail.loading')}</output>
          )}
        </ItemContent>
        {error && (
          <ItemActions className="ml-auto">
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {t('panel.retry')}
            </Button>
          </ItemActions>
        )}
      </li>
    </Item>
  );
}
