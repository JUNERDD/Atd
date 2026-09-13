/* oxlint-disable jsx-a11y/prefer-tag-over-role -- CodeMirror retains textbox focus and owns the listbox keyboard model. */
import { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Prec, StateField } from '@codemirror/state';
import { EditorView, showTooltip, type Tooltip, type TooltipView } from '@codemirror/view';
import {
  acceptCompletion,
  currentCompletions,
  selectedCompletionIndex,
  setSelectedCompletion,
  type Completion,
} from '@codemirror/autocomplete';
import { ScrollArea } from '@ai/ui/components/scroll-area';

function CompletionList({
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
  const selectedOption = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const scrollOptions = { block: 'nearest', inline: 'nearest', container: 'nearest' } as const;
    selectedOption.current?.scrollIntoView(scrollOptions);
    view.requestMeasure();
  }, [options, selected, view]);
  return (
    <ScrollArea className="instruction-completion-scroll-area">
      <div id={id} role="listbox" aria-label="Variable suggestions" className="completion-options">
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

function createCompletionTooltip(view: EditorView): TooltipView {
  const dom = document.createElement('div');
  dom.className = 'cm-tooltip-autocomplete instruction-completion';
  const root = createRoot(dom);
  const render = () => {
    root.render(
      <CompletionList
        view={view}
        id={view.state.field(completionPresentation).id}
        options={currentCompletions(view.state)}
        selected={selectedCompletionIndex(view.state)}
      />,
    );
  };
  return {
    dom,
    overlap: true,
    mount: render,
    update: render,
    // CodeMirror may be destroyed during its parent React commit.
    destroy: () => queueMicrotask(() => root.unmount()),
  };
}

const completionPresentation = StateField.define<{
  id: string;
  tooltip: Tooltip | null;
  selected: number | null;
}>({
  create: () => ({
    id: `instruction-completions-${crypto.randomUUID()}`,
    tooltip: null,
    selected: null,
  }),
  update: (previous, transaction) => ({
    id: previous.id,
    selected: selectedCompletionIndex(transaction.state),
    tooltip: currentCompletions(transaction.state).length
      ? { pos: transaction.state.selection.main.head, create: createCompletionTooltip }
      : null,
  }),
  provide: (field) => [
    showTooltip.from(field, (value) => value.tooltip),
    Prec.highest(
      EditorView.contentAttributes.from(
        field,
        ({ id, tooltip, selected }): Record<string, string> =>
          tooltip
            ? {
                'aria-controls': id,
                'aria-activedescendant':
                  selected === null || selected < 0 ? '' : `${id}-${selected}`,
              }
            : {},
      ),
    ),
  ],
});

// Completion matching, activation, selection and keybindings remain owned by CodeMirror.
export const instructionCompletion = completionPresentation;
