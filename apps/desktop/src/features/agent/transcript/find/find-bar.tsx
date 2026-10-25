import type { CompositionEvent, KeyboardEvent, MouseEvent, RefObject } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isComposingKey } from '@atd/ui/lib/ime';
import { HintButton } from './hint-button';

/** The bar's buttons act on the field's query, so a press leaves the caret in the field. */
function keepFocus(event: MouseEvent) {
  event.preventDefault();
}

/**
 * The find bar: a glass capsule floating under the panel header over the transcript's top edge,
 * with the field, the match count, previous and next, and close. Return and Shift-Return step
 * through the matches and Escape closes, outside an IME composition; Escape stays with the bar so
 * the panel does not take it too.
 */
export function FindBar({
  barRef,
  inputRef,
  text,
  searching,
  total,
  current,
  onChange,
  compositionProps,
  onStep,
  onClose,
}: {
  barRef: RefObject<HTMLElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  /** The field's text, which follows an IME composition too. */
  text: string;
  /** A query is searched (the count shows only then). */
  searching: boolean;
  total: number;
  current: number;
  onChange: (text: string) => void;
  compositionProps: {
    onCompositionStart: () => void;
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => void;
  };
  onStep: (direction: -1 | 1) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('panel');
  const count = !searching
    ? ''
    : total > 0
      ? t('find.count', { index: current + 1, total })
      : t('find.none');
  /** Heard in the field and on the buttons: whatever in the bar has focus. */
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || isComposingKey(event)) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  return (
    <search
      ref={barRef}
      aria-label={t('find.label')}
      className="conversation-find glass-control surface-glass"
    >
      <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        value={text}
        placeholder={t('find.label')}
        aria-label={t('find.label')}
        autoComplete="off"
        spellCheck={false}
        className="conversation-find-input"
        onChange={(event) => onChange(event.currentTarget.value)}
        {...compositionProps}
        onKeyDown={(event) => {
          closeOnEscape(event);
          if (event.key !== 'Enter' || isComposingKey(event)) return;
          event.preventDefault();
          onStep(event.shiftKey ? -1 : 1);
        }}
      />
      <span className="conversation-find-count" aria-live="polite">
        {count}
      </span>
      <HintButton
        label={t('find.previous')}
        accelerator="Shift+Enter"
        variant="glass-ghost"
        size="icon-xs"
        className="rounded-full"
        disabled={total === 0}
        onMouseDown={keepFocus}
        onKeyDown={closeOnEscape}
        onClick={() => onStep(-1)}
      >
        <ChevronUp />
      </HintButton>
      <HintButton
        label={t('find.next')}
        accelerator="Enter"
        variant="glass-ghost"
        size="icon-xs"
        className="rounded-full"
        disabled={total === 0}
        onMouseDown={keepFocus}
        onKeyDown={closeOnEscape}
        onClick={() => onStep(1)}
      >
        <ChevronDown />
      </HintButton>
      <HintButton
        label={t('find.close')}
        accelerator="Escape"
        variant="glass-ghost"
        size="icon-xs"
        className="rounded-full"
        onMouseDown={keepFocus}
        onKeyDown={closeOnEscape}
        onClick={onClose}
      >
        <X />
      </HintButton>
    </search>
  );
}
