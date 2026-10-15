import * as React from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { cn } from '@atd/ui/lib/utils';

/**
 * Whether the engine sizes a textarea to its content in CSS (`field-sizing`, WebKit 26.2+). Engines
 * without it ignore the `field-sizing-content` class and get `react-textarea-autosize` instead.
 */
const NATIVE_AUTO_SIZE = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

/**
 * `style` is left out because the autosize library's own `Style` type is not `CSSProperties`; the
 * library owns the inline height, so a caller could not set one anyway.
 */
type TextareaProps = Omit<React.ComponentProps<'textarea'>, 'style'> & {
  /**
   * Grows the field with its content on every engine. Turn it off for a fixed-size, user-resizable
   * field (with `field-sizing-fixed resize-y`): the fallback's inline height would override it.
   */
  autoSize?: boolean;
};

function Textarea({ className, autoSize = true, ...props }: TextareaProps) {
  const classes = cn(
    'flex field-sizing-content min-h-16 w-full resize-none rounded-2xl border border-transparent bg-input/50 px-2.5 py-2 text-sm transition-[color,box-shadow] duration-200 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
    className,
  );
  if (NATIVE_AUTO_SIZE || !autoSize) {
    return <textarea data-slot="textarea" className={classes} {...props} />;
  }
  return <AutoSizeTextarea data-slot="textarea" className={classes} {...props} />;
}

/**
 * The fallback: `react-textarea-autosize`, plus the two things it leaves to its host, so the field
 * fits its content as `field-sizing: content` would.
 * - Its own scrollbar. The library measures a hidden clone with `overflow: hidden` at the field's
 *   width, so a scrollbar the field shows while it is still too short (always-visible scrollbars)
 *   narrows only the field, which then wraps a line more than measured and keeps the bar. The
 *   field hides vertical overflow while its box is as tall as the measured content, and leaves
 *   overflow to its classes once a max height or the layout caps the box, so a capped field
 *   scrolls.
 * - Its own width. The library measures again when it renders, the window resizes or fonts load,
 *   not when only the field's width changes (a scroll area's bar lane appearing beside it), so a
 *   width change re-renders it.
 */
function AutoSizeTextarea({ ref, ...props }: Omit<TextareaProps, 'autoSize'>) {
  // Rendering is the library's cue to measure; compiled memoization would return the same element
  // and skip that render, so this component opts out.
  'use no memo';
  const node = React.useRef<HTMLTextAreaElement | null>(null);
  /** The library's last height for the content (border box), which the field's box may cap. */
  const contentHeight = React.useRef(0);
  const [, remeasure] = React.useReducer((count: number) => count + 1, 0);
  // The library takes one ref: this one keeps the field and passes it on to the caller's.
  const setNode = React.useCallback(
    (element: HTMLTextAreaElement | null) => {
      node.current = element;
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );

  React.useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    let width: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const inlineSize = entry?.borderBoxSize[0]?.inlineSize;
      // The first report measures again too: layout can change between the library's first
      // measure and the first frame, as when a scroll area adds its lane in an effect. The render
      // is scheduled, not run here: a new height inside this callback would make observers of the
      // field's ancestors (a scroll area's) skip a frame and report a loop error.
      if (inlineSize !== width) {
        width = inlineSize;
        remeasure();
      }
      fitOverflow(element, contentHeight.current);
    });
    observer.observe(element, { box: 'border-box' });
    return () => observer.disconnect();
  }, []);

  return (
    <TextareaAutosize
      ref={setNode}
      onHeightChange={(height) => {
        contentHeight.current = height;
        if (node.current) fitOverflow(node.current, height);
      }}
      {...props}
    />
  );
}

/**
 * Hides the field's vertical overflow while its box is as tall as its content, and clears it once
 * the box is capped at least a pixel shorter (rounding never counts), so the field's classes let it
 * scroll. Neither state changes the field's border box, so its resize observer stays quiet.
 */
function fitOverflow(element: HTMLTextAreaElement, contentHeight: number) {
  element.style.overflowY = contentHeight - element.offsetHeight >= 1 ? '' : 'hidden';
}

export { Textarea, type TextareaProps };
