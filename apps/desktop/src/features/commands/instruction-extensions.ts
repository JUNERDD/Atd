import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import {
  Decoration,
  EditorView,
  MatchDecorator,
  tooltips,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import { availableVariables } from '../../../electron/agent/command-validation';
import { contextVariables, parameterVariables } from './command-variables';
import { instructionCompletion } from './instruction-completion';

export function instructionExtensions(command: CommandDefinition) {
  const names = availableVariables(command);
  const variables = [...contextVariables, ...parameterVariables(command)].filter(({ name }) =>
    names.includes(name),
  );
  const matcher = new MatchDecorator({
    regexp: /\{\{\s*([^{}]+?)\s*\}\}/g,
    decoration: (match) =>
      Decoration.mark({
        class: names.includes(match[1]!.trim()) ? 'variable-token' : 'variable-invalid',
      }),
  });
  const highlights = ViewPlugin.fromClass(
    class {
      decorations;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.decorations = matcher.updateDeco(update, this.decorations);
      }
    },
    { decorations: (instance) => instance.decorations },
  );
  const complete = (context: CompletionContext) => {
    const word = context.matchBefore(/\{\{[\w.]*/);
    if (!word) return null;
    return {
      from: word.from,
      options: variables.map(({ name, detail }) => ({
        label: `{{${name}}}`,
        detail,
        apply: `{{${name}}}`,
      })),
      validFor: /^\{\{[\w.]*$/,
    };
  };
  return [
    EditorView.lineWrapping,
    highlights,
    // Match the variable picker's safe inset at the native window edges.
    tooltips({
      parent: document.body,
      tooltipSpace: (view) => {
        const viewport = view.dom.ownerDocument.documentElement;
        return {
          left: 8,
          top: 8,
          right: viewport.clientWidth - 8,
          bottom: viewport.clientHeight - 8,
        };
      },
    }),
    autocompletion({
      override: [complete],
      activateOnTyping: true,
      icons: false,
      tooltipClass: () => 'instruction-completion-measure',
    }),
    instructionCompletion,
    EditorView.contentAttributes.of({ 'aria-label': 'Instructions', spellcheck: 'false' }),
  ];
}
