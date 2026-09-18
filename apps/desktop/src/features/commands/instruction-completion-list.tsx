/* oxlint-disable jsx-a11y/prefer-tag-over-role -- CodeMirror retains textbox focus and owns the listbox keyboard model. */
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorView } from '@codemirror/view';
import { acceptCompletion, type Completion, setSelectedCompletion } from '@codemirror/autocomplete';
import { ScrollArea } from '@ai/ui/components/scroll-area';

export function CompletionList({
  view,
  id,
  options,
  selected,
}: {
  view: EditorView;
  id: string;
  options: readonly Completion[];
  selected: number | null;
}) {
  const { t } = useTranslation('commands');
  const selectedOption = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const scrollOptions = { block: 'nearest', inline: 'nearest', container: 'nearest' } as const;
    selectedOption.current?.scrollIntoView(scrollOptions);
    view.requestMeasure();
  }, [options, selected, view]);
  return (
    <ScrollArea className="flex-1 max-h-[inherit]">
      <div
        id={id}
        role="listbox"
        aria-label={t('variables.suggestions')}
        className="completion-options"
      >
        {options.map((option, index) => (
          <button
            key={option.label}
            ref={index === selected ? selectedOption : undefined}
            id={`${id}-${index}`}
            type="button"
            role="option"
            aria-selected={index === selected}
            tabIndex={-1}
            className="completion-option"
            title={`${option.label}${option.detail ? `\n${option.detail}` : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              view.dispatch({ effects: setSelectedCompletion(index) });
              acceptCompletion(view);
              view.focus();
            }}
          >
            <span className="cm-completionLabel">{option.label}</span>
            <span className="cm-completionDetail">{option.detail}</span>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
