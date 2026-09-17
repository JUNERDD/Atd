import { createRoot } from 'react-dom/client';
import { Prec, StateField } from '@codemirror/state';
import { EditorView, showTooltip, type Tooltip, type TooltipView } from '@codemirror/view';
import { currentCompletions, selectedCompletionIndex } from '@codemirror/autocomplete';
import { CompletionList } from './instruction-completion-list';

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
