import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskAgentDefinition } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
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
 * A task agent's role text behind a link that shows it below (as memory suggestions show theirs),
 * at its full height in a card that already scrolls, so the reader never scrolls twice. The region
 * stays in the page while hidden, so the link's `aria-controls` always names it.
 */
export function TaskAgentInstructions({ text }: { text: string }) {
  const { t } = useTranslation('tasks');
  const regionId = useId();
  const [open, setOpen] = useState(false);
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
        {open && <p className="task-agent-instructions-text">{text}</p>}
      </div>
    </>
  );
}

/**
 * What a task agent is, in the popover its drill-in title opens (`LayerHeader` details): what it
 * does first, then its tools and effort, then its role text in full, read as one body under the
 * popover's heading.
 */
export function TaskAgentDetails({ definition }: { definition: TaskAgentDefinition }) {
  const { t } = useTranslation('tasks');
  const instructionsId = useId();
  return (
    <div className="task-agent-details">
      <p>{definition.description}</p>
      <TaskAgentFacts definition={definition} />
      <section aria-labelledby={instructionsId}>
        <h3 id={instructionsId}>{t('subagent.role.instructions')}</h3>
        <p>{definition.instructions}</p>
      </section>
    </div>
  );
}
