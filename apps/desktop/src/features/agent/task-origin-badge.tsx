import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import type { TaskOrigin } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { AppOriginBadge } from '../apps/app-origin-badge';
import { useAutomations } from '../automations/use-automations';

/**
 * Marks a history row whose task an automation started, right after its title: the automation's
 * name while it exists, a generic label after it was deleted. The title truncates first; the
 * badge keeps at most half the line, as an app's does.
 */
function AutomationOriginBadge({
  origin,
}: {
  origin: Extract<TaskOrigin, { kind: 'automation' }>;
}) {
  const { t } = useTranslation('tasks');
  const { automations } = useAutomations();
  const name =
    automations?.find(({ automation }) => automation.id === origin.automationId)?.automation.name ??
    t('history.origin.automationUnknown');
  return (
    <Badge
      variant="secondary"
      className="max-w-1/2 shrink-0"
      title={t('history.origin.automation', { name })}
    >
      <Zap aria-hidden="true" />
      <span className="truncate">{name}</span>
    </Badge>
  );
}

/** Who started a task the person did not: a user app, or an automation. */
export function TaskOriginBadge({ origin }: { origin: TaskOrigin }) {
  switch (origin.kind) {
    case 'app':
      return <AppOriginBadge origin={origin} />;
    case 'automation':
      return <AutomationOriginBadge origin={origin} />;
  }
}
