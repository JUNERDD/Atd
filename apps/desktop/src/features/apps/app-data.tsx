import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@atd/ui/components/item';
import { Spinner } from '@atd/ui/components/spinner';
import { AppDetailSection } from './app-detail-group';
import type { AppIntent } from './use-app-intent';

/**
 * One action that loses data: what it removes and what stays, with its button at the trailing
 * edge. The button opens a confirmation; once confirmed it shows its progress in place.
 */
function AppDataRow({
  title,
  description,
  action,
  progress,
  destructive,
  busy,
  running,
  onClick,
}: {
  title: string;
  description: string;
  action: string;
  progress: string;
  destructive: boolean;
  busy: boolean;
  running: boolean;
  onClick: () => void;
}) {
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li aria-busy={running || undefined}>
        <ItemContent className="min-w-[min(120px,100%)]">
          <ItemTitle className="whitespace-normal">{title}</ItemTitle>
          <ItemDescription className="whitespace-normal">{description}</ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto">
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'outline'}
            size="sm"
            aria-disabled={busy || undefined}
            aria-busy={running || undefined}
            onClick={onClick}
          >
            {running && <Spinner data-icon="inline-start" />}
            {running ? progress : action}
          </Button>
        </ItemActions>
      </li>
    </Item>
  );
}

/**
 * The app's data and the app itself, last on its page and apart from everything else: Clear data
 * empties the app's storage and keeps the app; Delete app removes it with every version.
 */
export function AppDataSection({
  busy,
  pending,
  onClear,
  onDelete,
}: {
  busy: boolean;
  pending: AppIntent | null;
  onClear: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('apps');
  return (
    <AppDetailSection title={t('detail.data.title')} footer={t('detail.data.footer')}>
      <AppDataRow
        title={t('detail.data.clear')}
        description={t('detail.data.clearDescription')}
        action={t('detail.data.clearAction')}
        progress={t('detail.data.clearing')}
        destructive={false}
        busy={busy}
        running={pending === 'clear'}
        onClick={onClear}
      />
      <AppDataRow
        title={t('detail.data.delete')}
        description={t('detail.data.deleteDescription')}
        action={t('detail.data.deleteAction')}
        progress={t('detail.data.deleting')}
        destructive
        busy={busy}
        running={pending === 'delete'}
        onClick={onDelete}
      />
    </AppDetailSection>
  );
}
