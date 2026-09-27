import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CompositionEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

/*
 * IME composition boundaries. While an input method composes text (pinyin, kana, ...), its keys
 * belong to the IME: Enter commits and Esc cancels the composition, so product shortcuts must not
 * act on them, and searches must not filter on the uncommitted letters.
 */

/**
 * Whether a keydown belongs to an IME composition. `keyCode` 229 also covers the keydown that
 * starts a composition, which Chromium reports before `isComposing` turns true.
 */
export function isComposingKey(event: KeyboardEvent | ReactKeyboardEvent): boolean {
  const native = 'nativeEvent' in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}

/**
 * Wraps a Radix `onEscapeKeyDown`: the Esc that cancels a composition is prevented, which keeps
 * the layer open, and never reaches `handler`. Radix dismisses on any Escape keydown otherwise.
 */
export function ignoreComposingEscape(handler?: (event: KeyboardEvent) => void) {
  return (event: KeyboardEvent) => {
    if (isComposingKey(event)) event.preventDefault();
    else handler?.(event);
  };
}

/**
 * Search text for a controlled input plus the committed `query` to filter by. `text` follows every
 * change so the IME keeps its preedit; `query` follows it only outside a composition and takes the
 * committed text on `compositionend`, which Chromium fires after the composition's last input.
 * Spread `compositionProps` onto the input and route its changes through `change`.
 */
export function useCompositionQuery(initial = '') {
  const [text, setText] = useState(initial);
  const [query, setQuery] = useState(initial);
  const composing = useRef(false);
  const change = useCallback((value: string) => {
    setText(value);
    if (!composing.current) setQuery(value);
  }, []);
  const compositionProps = useMemo(
    () => ({
      onCompositionStart: () => {
        composing.current = true;
      },
      onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => {
        composing.current = false;
        change(event.currentTarget.value);
      },
    }),
    [change],
  );
  return { text, query, change, compositionProps };
}
