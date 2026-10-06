import './demos.css';

interface TaskHistoryProps {
  tasks: readonly { title: string; state: string }[];
}

/** A few rows of task history, as the panel lists them. Illustration only: the tile's text says it. */
export function TaskHistory({ tasks }: TaskHistoryProps) {
  return (
    <ul className="feat__tasks" aria-hidden="true">
      {tasks.map((task, index) => (
        <li className="feat__task" key={task.title} data-live={index === 1 ? '' : undefined}>
          <span className="feat__task-dot" />
          <span className="feat__task-title">{task.title}</span>
          <span className="feat__task-state mono-label">{task.state}</span>
        </li>
      ))}
    </ul>
  );
}

interface ComposerLineProps {
  lead: string;
  file: string;
  join: string;
  command: string;
}

/** A composer line with a file chip and a command chip, as `@` and `/` insert them. */
export function ComposerLine({ lead, file, join, command }: ComposerLineProps) {
  return (
    <p className="feat__composer" aria-hidden="true">
      <span>{lead}</span>
      <span className="feat__chip">
        <span className="feat__chip-key">@</span>
        {file}
      </span>
      <span>{join}</span>
      <span className="feat__chip-end">
        <span className="feat__chip">
          <span className="feat__chip-key">/</span>
          {command}
        </span>
        <span className="feat__caret" />
      </span>
    </p>
  );
}

interface ToolLogProps {
  steps: readonly { kind: string; target: string; result: string }[];
}

/** A run's steps as the conversation shows them inline: what ran, on what, and how it went. */
export function ToolLog({ steps }: ToolLogProps) {
  return (
    <ul className="feat__log" aria-hidden="true">
      {steps.map((step) => (
        <li className="feat__log-step" key={step.kind}>
          <span className="feat__log-kind mono-label">{step.kind}</span>
          <span className="feat__log-target">{step.target}</span>
          <span className="feat__log-result">{step.result}</span>
        </li>
      ))}
    </ul>
  );
}
