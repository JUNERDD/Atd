import { Suspense, type ReactNode } from 'react';
import { ListCardGridPlaceholder } from '../../components/list-card';
import {
  FieldsPlaceholder,
  ItemsPlaceholder,
  LoadingPlaceholder,
} from '../../components/loading-placeholder';

/** Suspense boundary with the content-shaped skeleton matching a secondary panel view. */
export function PanelSectionSuspense({
  kind,
  label,
  children,
}: {
  kind: 'history' | 'apps' | 'input';
  label: string;
  children: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <section className="panel-content task-history">
          <LoadingPlaceholder label={label}>
            {kind === 'history' ? (
              <ItemsPlaceholder count={4} trailing="none" />
            ) : kind === 'apps' ? (
              <ListCardGridPlaceholder count={2} />
            ) : (
              <FieldsPlaceholder count={2} />
            )}
          </LoadingPlaceholder>
        </section>
      }
    >
      {children}
    </Suspense>
  );
}
