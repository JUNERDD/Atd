import {
  acceptCompletion,
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { Prec } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  MatchDecorator,
  tooltips,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import { availableVariables } from '../../../electron/agent/command-validation';
import { instructionCompletion } from './instruction-completion';
import { rankVariables, typedVariable } from './instruction-variable-match';

export function instructionExtensions(
  command: Pick<CommandDefinition, 'input' | 'parameters'>,
  editor: { variables: { name: string; detail: string }[]; label: string },
) {
  const names = availableVariables(command);
  const variables = editor.variables.filter(({ name }) => names.includes(name));
  // Built per configuration and only re-ranked per query: CodeMirror keeps the selected option
  // across updates by object identity.
  const completions: Completion[] = variables.map(({ name, detail }) => ({
    label: `{{${name}}}`,
    detail,
    apply: `{{${name}}}`,
  }));
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
  /*
   * The shared matcher filters and orders the options, so CodeMirror keeps them as given
   * (`filter: false`). That rules out `validFor`, so `update` re-ranks synchronously as the name
   * is typed; otherwise each keystroke would query the source again, and until it answered the
   * list would be empty and Enter would not accept.
   */
  const complete = (context: CompletionContext): CompletionResult | null => {
    const typed = typedVariable(context.state, context.pos);
    if (!typed) return null;
    return {
      from: typed.from,
      options: rankVariables(completions, typed.query),
      filter: false,
      update: (_current, _from, _to, next) => complete(next),
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
      // The source is synchronous and cheap, so the list opens at `{{` instead of after a 100 ms
      // pause in typing; the default let fast typists press Enter before it appeared.
      activateOnTypingDelay: 0,
      icons: false,
      tooltipClass: () => 'instruction-completion-measure',
    }),
    // Tab accepts an open completion like Enter; without one it still indents.
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
    instructionCompletion,
    EditorView.contentAttributes.of({ 'aria-label': editor.label, spellcheck: 'false' }),
  ];
}
