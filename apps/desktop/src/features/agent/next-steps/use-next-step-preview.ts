import { useRef, useState, type FocusEvent, type RefObject } from 'react';

/**
 * The follow-up row the card's prompt preview points at, and how far that row sits from the card's
 * top and bottom edges. Radix places the preview against the card, its trigger, above or below it;
 * next-steps.css moves it by these offsets onto the row.
 */
export interface NextStepPreviewTarget {
  stepId: string;
  fromTop: number;
  fromBottom: number;
}

/**
 * The card's one prompt preview, which follows the hovered or focused follow-up row. Radix decides
 * when it opens and closes (`open`, mirrored here): the shared delay once on entering the card,
 * closing on leaving it, a click, Escape, a scroll or focus leaving it. This adds the row it points
 * at, and two exceptions to Radix waiting for the pointer to leave and re-enter the card before
 * opening again: after a scroll closes it, the next move over the row brings it back; after a click
 * or Escape dismisses a row, moving to another row does.
 */
export function useNextStepPreview(card: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<NextStepPreviewTarget | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Whether the preview has opened since the pointer or focus last entered the card.
  const engaged = useRef(false);
  const shown = target && target.stepId !== dismissed ? target : null;

  function onOpenChange(next: boolean) {
    if (next) engaged.current = true;
    setOpen(next);
  }
  /** Points the preview at `row`, or hides it over a row that has none (`stepId` null). */
  function point(row: HTMLElement, stepId: string | null) {
    const box = card.current?.getBoundingClientRect();
    if (!stepId || !box) {
      setTarget(null);
      return;
    }
    const rect = row.getBoundingClientRect();
    setTarget({ stepId, fromTop: rect.top - box.top, fromBottom: box.bottom - rect.bottom });
    setDismissed((current) => (current === stepId ? current : null));
  }

  return {
    open,
    onOpenChange,
    shown,
    point,
    /** Keeps the preview closed over `stepId` until another row is pointed at. */
    dismiss: setDismissed,
    /** Handlers for the card, the tooltip trigger. */
    card: {
      onBlur(event: FocusEvent<HTMLElement>) {
        // Focus moving between the card's own controls keeps the preview open.
        if (event.currentTarget.contains(event.relatedTarget)) event.preventDefault();
        else engaged.current = false;
      },
      onPointerLeave() {
        engaged.current = false;
        setDismissed(null);
      },
    },
    /** Handlers for the list of rows. */
    rows: {
      onPointerMove() {
        if (!open && engaged.current && shown) setOpen(true);
      },
      onPointerLeave() {
        setTarget(null);
      },
      onBlur(event: FocusEvent<HTMLElement>) {
        if (!event.currentTarget.contains(event.relatedTarget)) setTarget(null);
      },
    },
  };
}
