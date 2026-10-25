import { createContext, use, useCallback, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './hitl-queue-popover.css';

/** The HITL view's footer node, where `HitlActions` put a request's decisions. */
const HitlFooterContext = createContext<HTMLElement | null>(null);

/**
 * The HITL view's body and its footer: the footer follows `children` as a sibling, outside
 * whatever scrolls them, and every `HitlActions` among the children renders into it. The footer
 * node is the view's own from the first render, so a request mounting with the view already has
 * its decisions in place when its focus-on-arrival runs. The pill opens the view onto the first
 * enabled button of the body or, past it, of the footer (`data-panel-focus`).
 */
export function HitlFooterScope({ children }: { children: ReactNode }) {
  const [footer] = useState(() => document.createElement('div'));
  const place = useCallback((slot: HTMLDivElement | null) => slot?.append(footer), [footer]);
  return (
    <HitlFooterContext value={footer}>
      {children}
      <div ref={place} className="hitl-queue-footer" data-panel-focus />
    </HitlFooterContext>
  );
}

/**
 * A request's decision row and the error a decision returned. In the HITL view they stay in its
 * footer, in reach however long the request reads; anywhere else they render in place.
 */
export function HitlActions({ error, children }: { error?: string; children: ReactNode }) {
  const footer = use(HitlFooterContext);
  const actions = (
    <div className="hitl-actions">
      <div className="approval-actions">{children}</div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
  return footer ? createPortal(actions, footer) : actions;
}
