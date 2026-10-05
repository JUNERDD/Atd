import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SubagentDefineDetails } from '@atd/agent-contracts';
import { TaskAgentFacts, TaskAgentInstructions } from '../task-agents/task-agent-role';
import { agentDisplayName } from '../task-agents/task-agents';
import { ToolCard } from './tool-card';

/**
 * A `subagent { action: "define" }` row's detail: one card listing the task agents the call
 * recorded, each by the name the task's subagents then run as (without the `task.` prefix), with
 * its description, tools and effort, and its role text on request. The header copies the result
 * the agent read.
 */
export function SubagentDefineBody({
  details,
  copyText,
}: {
  details: SubagentDefineDetails;
  copyText: string;
}) {
  const { t } = useTranslation('tasks');
  return (
    <ToolCard.Root>
      <ToolCard.Header
        icon={<Bot />}
        label={t('subagent.definedCount', { count: details.agents.length })}
        copyText={copyText}
      />
      <ToolCard.Body size="lg">
        <ul className="task-agent-definitions">
          {details.agents.map((definition) => (
            <li key={definition.agent} className="task-agent-definition">
              <p className="task-agent-name">{agentDisplayName(definition.agent)}</p>
              <p className="task-agent-description">{definition.description}</p>
              <TaskAgentFacts definition={definition} />
              <TaskAgentInstructions text={definition.instructions} />
            </li>
          ))}
        </ul>
      </ToolCard.Body>
    </ToolCard.Root>
  );
}
