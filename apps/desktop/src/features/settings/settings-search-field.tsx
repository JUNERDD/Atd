import { useImperativeHandle, useRef, type KeyboardEvent, type Ref } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@ai/ui/components/input-group';
import { isComposingKey, type useCompositionQuery } from '@ai/ui/lib/ime';
import { cn } from '@ai/ui/lib/utils';

/**
 * The search field of the settings window: the section search in the navigation card and each
 * page's own list search. It shows a Clear button while it holds text, and Escape clears it
 * (outside an IME composition, whose Escape belongs to the input method) without closing the
 * layer around it. Filter by `search.query`, which follows the text only once a composition
 * commits.
 */
export function SettingsSearchField({
  search,
  ref,
  className,
  disabled,
  onKeyDown,
  ...props
}: {
  /** The field's text and committed query, from `useCompositionQuery`. */
  search: ReturnType<typeof useCompositionQuery>;
  /** The text input itself, for focusing it. */
  ref?: Ref<HTMLInputElement>;
  /** Classes for the field's outer group. */
  className?: string;
  'aria-label': string;
  placeholder?: string;
  disabled?: boolean;
  /** Runs before the field's own Escape handling; prevent the default to skip it. */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { t } = useTranslation('settings');
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!, []);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || isComposingKey(event)) return;
    if (event.key === 'Escape' && search.text) {
      event.preventDefault();
      event.stopPropagation();
      search.change('');
    }
  }

  return (
    <InputGroup
      className={cn('settings-search-field', className)}
      data-disabled={disabled || undefined}
    >
      <InputGroupInput
        ref={input}
        {...props}
        value={search.text}
        disabled={disabled}
        onChange={(event) => search.change(event.target.value)}
        onKeyDown={handleKeyDown}
        {...search.compositionProps}
      />
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
      {search.text && !disabled && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={t('search.clear')}
            onClick={() => {
              search.change('');
              input.current?.focus();
            }}
          >
            <X aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
