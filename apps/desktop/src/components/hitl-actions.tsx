import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import './hitl-queue-popover.css';

/**
 * The HITL view's footer node, where `HitlActions` put a request's decisions, and whether it is in
 * the document yet.
 */
const HitlFooterContext = createContext<{ footer: HTMLElement; placed: boolean } | null>(null);

/**
 * The HITL view's body and its footer: the footer follows `children` as a sibling, outside
 * whatever scrolls them, and every `HitlActions` among the children renders into it. The footer
 * node is the view's own from the first render, so a request mounting with the view already has
 * its decisions in place when its focus-on-arrival runs. It joins the document only after the
 * children's layout effects, where decisions measured nothing; placing it re-renders them, still
 * before the first paint, so they measure again. The pill opens the view onto the first enabled
 * button of the body or, past it, of the footer (`data-panel-focus`).
 */
export function HitlFooterScope({ children }: { children: ReactNode }) {
  const [footer] = useState(() => document.createElement('div'));
  const [placed, setPlaced] = useState(false);
  const place = useCallback(
    (slot: HTMLDivElement | null) => {
      if (!slot) return;
      slot.append(footer);
      setPlaced(true);
    },
    [footer],
  );
  return (
    <HitlFooterContext value={{ footer, placed }}>
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
  const scope = use(HitlFooterContext);
  const row = useRef<HTMLDivElement>(null);
  const stacked = useStackedDecisions(row);
  const actions = (
    <div className="hitl-actions">
      <div ref={row} className="approval-actions" data-stacked={stacked || undefined}>
        {children}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
  return scope ? createPortal(actions, scope.footer) : actions;
}

/**
 * Whether the decisions stack: they sit side by side at their natural widths while all of them fit
 * the row, and otherwise take one full-width row each, so a wrap never leaves one alone on a row
 * of its own. The row is measured on every render, since its labels change with the request and
 * the language and its footer may have just been placed, and whenever it or a decision resizes.
 */
function useStackedDecisions(row: RefObject<HTMLDivElement | null>) {
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const node = row.current;
    // Outside the document nothing has a size yet; the footer's placement measures again.
    if (!node?.isConnected) return;
    const measure = () => {
      const decisions = [...node.children];
      const gaps = (decisions.length - 1) * (parseFloat(getComputedStyle(node).columnGap) || 0);
      const needed = decisions.reduce((sum, decision) => sum + naturalWidth(decision), gaps);
      // Decisions need half a pixel to spare to sit side by side, so rounding between the measured
      // parts and the row never passes a row that wraps as one that fits.
      setStacked(needed > node.getBoundingClientRect().width - 0.5);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const decision of node.children) observer.observe(decision);
    return () => observer.disconnect();
  });
  return stacked;
}

/**
 * A decision's width in a row: its content's extent plus its padding and border. Its own box cannot
 * say once stacked, where it spans the row; its content stays centered at its natural size.
 */
function naturalWidth(decision: Element) {
  const content = document.createRange();
  content.selectNodeContents(decision);
  const style = getComputedStyle(decision);
  return (
    content.getBoundingClientRect().width +
    parseFloat(style.paddingLeft) +
    parseFloat(style.paddingRight) +
    parseFloat(style.borderLeftWidth) +
    parseFloat(style.borderRightWidth)
  );
}
