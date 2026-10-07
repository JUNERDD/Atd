import type { ReactNode } from 'react';

/**
 * One group of a settings editor (an automation, a command, an MCP server): a hairline above it,
 * then a title and a line saying what the group decides, so each group reads as its own block
 * rather than as one more field. A group's action, such as Add, sits at the end of its header.
 */
export function SettingsGroup({
  id,
  title,
  description,
  action,
  children,
}: {
  /** Prefix of the title's and description's element ids. */
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
  /** Omitted when the description says all there is, such as settings that do not apply. */
  children?: ReactNode;
}) {
  return (
    <section
      className="settings-group"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
    >
      <header className="settings-group-header">
        <div className="settings-group-heading">
          <h3 id={`${id}-title`} className="settings-section-title">
            {title}
          </h3>
          <p id={`${id}-description`} className="settings-field-note">
            {description}
          </p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
