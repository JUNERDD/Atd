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
  return <TextareaAutosize data-slot="textarea" className={classes} {...props} />;
}

export { Textarea, type TextareaProps };
