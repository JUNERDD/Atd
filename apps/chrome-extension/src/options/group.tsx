import { Children, useId, type ReactNode } from 'react';

/**
 * One group of the settings pane, as a section of a Mac grouped form: its title, its rows on one
 * raised surface, the buttons that act on the whole group trailing under it, then the footers that
 * say what the group means. Each group writes its own footers, so its controls can point at them.
 * A group with no rows yet (the shortcuts before Chrome reported them) draws no empty surface.
 */
export function Group({
  title,
  actions,
  footer,
  children,
}: {
  title: string;
  actions?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className="op-group" aria-labelledby={titleId}>
      {/* Focusable from code only: where focus goes when the control it was on leaves the group. */}
      <h2 className="list-header" id={titleId} tabIndex={-1}>
        {title}
      </h2>
      {Children.count(children) > 0 ? <ul className="list op-list">{children}</ul> : null}
      {actions ? <div className="op-actions">{actions}</div> : null}
      {footer}
    </section>
  );
}

/**
 * A row: its label leading and its value or control trailing. The label wraps and the trailing part
 * keeps its size; where the two cannot sit side by side, the trailing part moves under the label.
 * `secondary` is a row that only says something (an empty list), in secondary text.
 */
export function Row({
  label,
  labelId,
  secondary = false,
  children,
}: {
  label: ReactNode;
  labelId?: string;
  secondary?: boolean;
  children?: ReactNode;
}) {
  return (
    <li>
      <div className="list__row op-row" data-tone={secondary ? 'secondary' : undefined}>
        <span className="list__label" id={labelId}>
          {label}
        </span>
        {children}
      </div>
    </li>
  );
}
