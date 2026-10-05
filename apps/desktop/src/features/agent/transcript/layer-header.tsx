import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../../../components/icon-button';

/**
 * The header of a view laid over a conversation (a subagent's drill-in, a side chat): the way back
 * and where the view sits, as "parent › view". The view carries no task, status or error of its
 * own here; `actions` (a More menu) may trail the row, and `children` (facts about the view, such
 * as a task agent's role) sit under it. The back action takes focus on open so keyboard users land
 * inside the new view, unless `takeFocus` is off for a view that focuses its own first field.
 */
export function LayerHeader({
  parentTitle,
  title,
  backLabel,
  breadcrumbLabel,
  onBack,
  takeFocus = true,
  actions,
  children,
}: {
  parentTitle: string;
  title: string;
  backLabel: string;
  /** Names the breadcrumb navigation for assistive technology. */
  breadcrumbLabel: string;
  onBack: () => void;
  takeFocus?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  // Only as the view opens: a later `takeFocus` change must not pull focus back here.
  const focusOnOpen = useRef(takeFocus);
  useEffect(() => {
    if (focusOnOpen.current) backRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <header className="child-header">
      <div className="flex min-w-0 items-center gap-1">
        <IconButton ref={backRef} label={backLabel} className="-ml-1.5" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <nav aria-label={breadcrumbLabel} className="min-w-0 flex-1">
          <ol className="m-0 flex min-w-0 list-none items-center gap-1 p-0 text-sm">
            <li className="min-w-0 truncate text-muted-foreground" title={parentTitle}>
              {parentTitle}
            </li>
            <li aria-hidden="true" className="flex shrink-0 text-muted-foreground">
              <ChevronRight className="size-3.5" />
            </li>
            <li
              aria-current="page"
              className="max-w-2/3 shrink-0 truncate font-medium"
              title={title}
            >
              {title}
            </li>
          </ol>
        </nav>
        {actions}
      </div>
      {children}
    </header>
  );
}
