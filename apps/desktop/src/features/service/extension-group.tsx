import type { ReactNode } from 'react';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@ai/ui/components/empty';
import { ItemGroup } from '@ai/ui/components/item';

/** Shared Skills/Roles/MCP group shell with loading, empty, and row slots. */
export function ExtensionGroup({
  title,
  note,
  empty,
  loading,
  emptyAction,
  emptyIcon,
  footer,
  children,
  hasRows,
  showTitle = true,
}: {
  title: string;
  note: string;
  empty: string;
  loading: boolean;
  hasRows: boolean;
  emptyAction?: ReactNode;
  emptyIcon?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  /** Tab pages supply the visible heading; the section name stays for accessibility. */
  showTitle?: boolean;
}) {
  return (
    <section className="settings-extension-group" aria-label={title}>
      {showTitle ? <h3>{title}</h3> : null}
      {loading && !hasRows ? (
        note ? (
          <p className="settings-field-note">{note}</p>
        ) : null
      ) : hasRows ? (
        <>
          {note ? <p className="settings-field-note">{note}</p> : null}
          <ItemGroup>{children}</ItemGroup>
          {footer}
        </>
      ) : (
        <div className="settings-extension-empty">
          <Empty>
            <EmptyHeader>
              {emptyIcon ? <EmptyMedia variant="icon">{emptyIcon}</EmptyMedia> : null}
              <EmptyTitle>{empty}</EmptyTitle>
            </EmptyHeader>
            {emptyAction ? <EmptyContent>{emptyAction}</EmptyContent> : null}
          </Empty>
        </div>
      )}
    </section>
  );
}
