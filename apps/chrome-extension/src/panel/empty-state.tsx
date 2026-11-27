import type { ReactNode } from 'react';

/**
 * The kit's empty state, centered in the panel's free space: the Atd mark, a title, one line on
 * what to do, and the step that may help. It opens the empty panel, the connect flow and every
 * explanatory state.
 */
export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <section className="empty-state pp-empty">
      <span className="atd-mark empty-state__symbol" aria-hidden="true" />
      <h2 className="empty-state__title">{title}</h2>
      <p className="empty-state__description">{body}</p>
      {children}
    </section>
  );
}
