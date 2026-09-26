import type { ReactNode } from 'react';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@ai/ui/components/empty';
import { ItemGroup } from '@ai/ui/components/item';

/** Shared Skills/Roles/MCP group shell with loading, empty, and row slots. */
export function ExtensionGroup({
  title,
  empty,
  loading,
  emptyAction,
  emptyIcon,
  status,
  children,
  hasRows,
  showTitle = true,
}: {
  title: string;
  empty: string;
  loading: boolean;
  hasRows: boolean;
  emptyAction?: ReactNode;
  emptyIcon?: ReactNode;
  /** Transient status above the rows, such as where the last restore backed up a copy. */
  status?: ReactNode;
  children?: ReactNode;
  /** Tab pages supply the visible heading; the section name stays for accessibility. */
  showTitle?: boolean;
}) {
  return (
    <section className="settings-extension-group" aria-label={title}>
      {showTitle ? <h3>{title}</h3> : null}
      {loading && !hasRows ? null : hasRows ? (
        <>
          {status}
          <ItemGroup>{children}</ItemGroup>
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
