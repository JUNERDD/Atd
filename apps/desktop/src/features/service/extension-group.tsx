import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@ai/ui/components/empty';
import { ItemGroup } from '@ai/ui/components/item';

/**
 * Shared plugin, skill, subagent and MCP group shell with loading, empty, and row or card slots.
 * While the first load runs without rows, the group says so instead of going blank.
 */
export function ExtensionGroup({
  title,
  empty,
  emptyDescription,
  loading,
  emptyAction,
  emptyIcon,
  status,
  children,
  hasRows,
  showTitle = true,
  cards = false,
}: {
  title: string;
  empty: string;
  /** Why the group is empty and what to do next, under the empty title. */
  emptyDescription?: string;
  loading: boolean;
  hasRows: boolean;
  emptyAction?: ReactNode;
  emptyIcon?: ReactNode;
  /** Transient status above the rows, such as where the last restore backed up a copy. */
  status?: ReactNode;
  children?: ReactNode;
  /** Tab pages supply the visible heading; the section name stays for accessibility. */
  showTitle?: boolean;
  /** Children are cards (`PluginCard`) in a grid that fits as many columns as the width allows. */
  cards?: boolean;
}) {
  const { t } = useTranslation('settings');
  return (
    <section className="settings-extension-group" aria-label={title}>
      {showTitle ? <h3 className="settings-section-title">{title}</h3> : null}
      {loading && !hasRows ? (
        <output className="settings-loading">{t('extensions.listLoading')}</output>
      ) : hasRows ? (
        <>
          {status}
          {cards ? (
            <ul className="plugin-card-grid">{children}</ul>
          ) : (
            <ItemGroup>{children}</ItemGroup>
          )}
        </>
      ) : (
        <div className="settings-extension-empty">
          <Empty>
            <EmptyHeader>
              {emptyIcon ? <EmptyMedia variant="icon">{emptyIcon}</EmptyMedia> : null}
              <EmptyTitle>{empty}</EmptyTitle>
              {emptyDescription ? <EmptyDescription>{emptyDescription}</EmptyDescription> : null}
            </EmptyHeader>
            {emptyAction ? <EmptyContent>{emptyAction}</EmptyContent> : null}
          </Empty>
        </div>
      )}
    </section>
  );
}
