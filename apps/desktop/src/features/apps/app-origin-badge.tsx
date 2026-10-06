import { useTranslation } from 'react-i18next';
import type { TaskOrigin } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { useApps } from './use-apps';

/**
 * Marks a history row whose task a user app started (`ctx.agent.run`), right after its title (Figma
 * `App / Task history row`, Origin=App): the app's name while the app exists, a generic label
 * after it was deleted. The title truncates first; the badge keeps at most half the line.
 */
export function AppOriginBadge({ origin }: { origin: Extract<TaskOrigin, { kind: 'app' }> }) {
  const { t } = useTranslation('apps');
  const { apps } = useApps();
  const name = apps?.find((app) => app.id === origin.appId)?.name ?? t('origin.unknown');
  return (
    <Badge variant="secondary" className="max-w-1/2 shrink-0" title={t('origin.label', { name })}>
      <span className="truncate">{name}</span>
    </Badge>
  );
}
