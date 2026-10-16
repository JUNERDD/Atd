import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Skeleton } from '@atd/ui/components/skeleton';
import { cn } from '@atd/ui/lib/utils';
import { TextPlaceholder } from '../../components/loading-placeholder';
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

/**
 * A short label line at a fixed length, for a label column sized by its longest label or a
 * group's title: percentage lengths would collapse a column that sizes to its content.
 */
export function LabelPlaceholder({ width = 'short' }: { width?: 'short' | 'long' }) {
  return (
    <span className="flex h-5 items-center">
      <Skeleton className={cn('h-3 rounded-full', width === 'short' ? 'w-14' : 'w-20')} />
    </span>
  );
}

/**
 * `ExtensionDetailFields` while its facts load (inside `LoadingPlaceholder`): the same panel and
 * label/value grid, with label and value lines of varying length.
 */
export function ExtensionDetailFieldsPlaceholder({ count = 4 }: { count?: number }) {
  return (
    <div className="extension-detail-fields">
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <LabelPlaceholder width={index % 2 ? 'short' : 'long'} />
          <TextPlaceholder width={index % 2 ? 'twoFifths' : 'threeFifths'} />
        </div>
      ))}
    </div>
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
      <h3 className="settings-section-title">{label}</h3>
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

/**
 * A read that failed, beside what it would have shown: the error, then Try again when the read can
 * be repeated.
 */
export function ExtensionLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: (() => void) | undefined;
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="extension-load-error">
      <p className="settings-inline-error" role="alert">
        <CircleAlert aria-hidden />
        <span>{message}</span>
      </p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t('extensions.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A note in place of what a details page would list, such as a plugin that contributes nothing.
 * Loading shows placeholders shaped like the page (`LoadingPlaceholder`), and a failed read
 * `ExtensionLoadError`.
 */
export function ExtensionDetailStatus({ text }: { text: string }) {
  return <output className="extension-detail-status">{text}</output>;
}
