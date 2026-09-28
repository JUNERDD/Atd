import type { ReactNode } from 'react';
import { LazyMarkdown } from '../agent/transcript/lazy-markdown';

export interface DetailField {
  label: string;
  value: ReactNode;
  /** Paths, revisions and commands: monospaced, and free to break anywhere. */
  mono?: boolean;
}

/** Read-only facts about one skill, subagent or MCP server, as a label/value panel. */
export function ExtensionDetailFields({ fields }: { fields: DetailField[] }) {
  if (!fields.length) return null;
  return (
    <dl className="extension-detail-fields">
      {fields.map((field) => (
        <div key={field.label}>
          <dt>{field.label}</dt>
          <dd className={field.mono ? 'font-mono' : undefined} data-mono={field.mono}>
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A titled block of a details page, such as a system prompt or a skill's files. */
export function ExtensionDetailSection({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={className ? `extension-detail-section ${className}` : 'extension-detail-section'}
      aria-label={label}
    >
      <h3>{label}</h3>
      {children}
    </section>
  );
}

/** Long Markdown shown in full, such as a subagent's system prompt. */
export function ExtensionDetailText({ label, value }: { label: string; value: string }) {
  return (
    <ExtensionDetailSection label={label}>
      <div className="extension-detail-text">
        <LazyMarkdown text={value} streaming={false} />
      </div>
    </ExtensionDetailSection>
  );
}

/** Replaces a details page's body while it loads or after it failed to load. */
export function ExtensionDetailStatus({ text, error }: { text: string; error: boolean }) {
  return (
    <output className="extension-detail-status" data-error={error}>
      {text}
    </output>
  );
}
