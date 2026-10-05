import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskAgentDefinition } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { cn } from '@atd/ui/lib/utils';
import './task-agents.css';

/**
 * Marks a task agent wherever it is named: the task defined it for itself, so it lives with the
 * task and is not one of the user's saved subagents.
 */
export function TemporaryBadge() {
  const { t } = useTranslation('tasks');
  return (
    <Badge variant="outline" title={t('subagent.temporaryHint')}>
      {t('subagent.temporary')}
    </Badge>
  );
}

/** A task agent's tools (as the model names them) and effort, as one wrapping line of facts. */
export function TaskAgentFacts({ definition }: { definition: TaskAgentDefinition }) {
  const { t } = useTranslation('tasks');
  const { t: tProviders } = useTranslation('providers');
  const tools = definition.tools.join(', ');
  return (
    <dl className="task-agent-facts">
      <div>
        <dt>{t('subagent.role.tools')}</dt>
        <dd className={cn(tools && 'font-mono')}>{tools || t('subagent.role.noTools')}</dd>
      </div>
      <div>
        <dt>{tProviders('thinkingLevels.label')}</dt>
        <dd>{tProviders(`thinkingLevels.levels.${definition.thinking}`)}</dd>
      </div>
    </dl>
  );
}

/**
 * A task agent's role text behind a link that shows it below (as memory suggestions show theirs).
 * In a fixed header it scrolls within a short box (`bounded`); in a card that already scrolls it
 * takes its full height, so the reader never scrolls twice. The region stays in the page while
 * hidden, so the link's `aria-controls` always names it.
 */
export function TaskAgentInstructions({
  text,
  bounded = false,
}: {
  text: string;
  bounded?: boolean;
}) {
  const { t } = useTranslation('tasks');
  const regionId = useId();
  const [open, setOpen] = useState(false);
  const content = <p className="task-agent-instructions-text">{text}</p>;
  return (
    <>
      <Button
        type="button"
        variant="link"
        size="xs"
        className="self-start px-0"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen(!open)}
      >
        {open ? t('subagent.role.hideInstructions') : t('subagent.role.showInstructions')}
      </Button>
      <div id={regionId} hidden={!open}>
        {open && bounded ? (
          <ScrollArea scrollShadow className="task-agent-instructions">
            {content}
          </ScrollArea>
        ) : (
          open && content
        )}
      </div>
    </>
  );
}

/**
 * A task agent's role under a drill-in view's breadcrumb: the Temporary mark beside its
 * description, then its tools and effort, and its role text on request. A child whose definition
 * the parent transcript no longer carries shows the mark alone.
 */
export function TaskAgentRole({ definition }: { definition: TaskAgentDefinition | undefined }) {
  return (
    <div className="task-agent-role">
      <div className="task-agent-role-summary">
        <TemporaryBadge />
        {definition && <p title={definition.description}>{definition.description}</p>}
      </div>
      {definition && (
        <>
          <TaskAgentFacts definition={definition} />
          <TaskAgentInstructions text={definition.instructions} bounded />
        </>
      )}
    </div>
  );
}
