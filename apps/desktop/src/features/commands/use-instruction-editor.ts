import { useLayoutEffect, useState, type RefCallback, type RefObject } from 'react';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import type { AgentTask } from '../../client/agent/task-schema';
import { chipDecorations } from '../composer-editor/chip-decorations';
import { chipIntegrity } from '../composer-editor/chip-integrity';
import { chipTable, plainText, segmentText } from '../composer-editor/chip-state';
import {
  createEditorCommands,
  type ComposerEditorCommands,
} from '../composer-editor/editor-commands';
import { routePanelKey } from '../composer-editor/editor-keys';
import type { ComboboxAria } from '../composer-editor/editor-state';
import { inputFilters } from '../composer-editor/input-filters';
import { refreshTrigger, sameTrigger, triggerField } from '../composer-editor/trigger-field';
import type { TriggerState } from '../quick-panel/trigger';
import type { QuickPanelHandle } from '../quick-panel/use-quick-panel';
import { instructionDocument, instructionText, pastedTokenChips } from './instruction-chips';
import { instructionTheme } from './instruction-theme';

export interface InstructionEditorOptions {
  /** The draft's instructions text, the single source of truth for the editor content. */
  instructions: string;
  onChange: (instructions: string) => void;
  onTrigger: (trigger: TriggerState | null) => void;
  panel: RefObject<QuickPanelHandle | null>;
  /** Snapshot tasks, for the titles of conversation chips. */
  tasks: readonly AgentTask[];
  /** Variable highlighting and `{{` completion; a new value reconfigures the editor. */
  variables: Extension;
  aria: ComboboxAria | null;
}

const variables = new Compartment();
const labelling = new Compartment();

function ariaExtension(aria: ComboboxAria | null): Extension {
  if (!aria) return [];
  return EditorView.contentAttributes.of({
    'aria-controls': aria.controls,
    ...(aria.activeDescendant ? { 'aria-activedescendant': aria.activeDescendant } : {}),
  });
}

/**
 * Owns the instruction editor's CodeMirror view: the composer's chip editing (chips, `/` and `@`
 * triggers, IME and paste handling) with `{{` variables, over instructions text in which chips are
 * typed tokens. While the user types, the editor leads and emits text; it is rebuilt only for text
 * it did not emit (a reload, a renamed parameter), which resets undo. Typing never reconfigures
 * the editor, so an open completion list survives it; the variable extension is swapped through a
 * compartment only when the offered variables change. Rebuilds wait for an IME composition to end.
 */
class InstructionEditorHost {
  readonly commands: ComposerEditorCommands;
  private options: InstructionEditorOptions;
  private view: EditorView | null = null;
  /** The instructions text of the editor content, last emitted or loaded. */
  private content: string;
  private appliedVariables: Extension;
  private appliedAria: ComboboxAria | null;
  private reported: TriggerState | null = null;
  /** The last trigger line, relative to the editor's top; see `triggerRect`. */
  private triggerLine: { top: number; height: number } | null = null;
  private readonly titles = (taskId: string) =>
    this.options.tasks.find((task) => task.id === taskId)?.title;

  constructor(options: InstructionEditorOptions) {
    this.options = options;
    this.content = options.instructions;
    this.appliedVariables = options.variables;
    this.appliedAria = options.aria;
    this.commands = createEditorCommands(() => this.view);
  }

  /** Stable ref callback for the host element; the returned cleanup destroys the view. */
  readonly container: RefCallback<HTMLDivElement> = (parent) => {
    if (!parent) return;
    this.reported = null;
    const view = new EditorView({ parent, state: this.load(this.options.instructions) });
    this.view = view;
    this.report(view.state);
    return () => {
      this.view = null;
      view.destroy();
    };
  };

  update(options: InstructionEditorOptions) {
    this.options = options;
    if (this.view) this.sync(this.view);
  }

  /**
   * Inserts text at the selection (a variable button). It edits the editor's own document, whose
   * change reaches the draft through `onChange`; editing the draft instead would race typing.
   */
  insertText(value: string) {
    const view = this.view;
    if (!view) {
      this.options.onChange(`${this.options.instructions}${value}`);
      return;
    }
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: value },
      selection: { anchor: from + value.length },
      scrollIntoView: true,
      userEvent: 'input.complete',
    });
    view.focus();
  }

  /**
   * The line of the open trigger across the editor's width, which the quick panel anchors to.
   * Once the trigger is gone (its `/` or `@` deleted) the panel still animates out, so the last
   * line is kept relative to the editor: falling back to the whole editor would flip the closing
   * panel above a tall editor.
   */
  triggerRect(): DOMRect {
    const view = this.view;
    if (!view) return new DOMRect();
    const box = view.dom.getBoundingClientRect();
    const trigger = view.state.field(triggerField).trigger;
    const line = trigger ? view.coordsAtPos(trigger.from, 1) : null;
    if (line) this.triggerLine = { top: line.top - box.top, height: line.bottom - line.top };
    if (!this.triggerLine) return box;
    const { top, height } = this.triggerLine;
    return new DOMRect(box.left, box.top + top, box.width, height);
  }

  private load(instructions: string): EditorState {
    const { doc, entries } = instructionDocument(instructions, this.titles);
    const state = EditorState.create({
      doc,
      extensions: [
        chipTable.init(() => new Map(entries.map(({ id, chip }) => [id, chip]))),
        chipDecorations,
        chipIntegrity,
        inputFilters,
        segmentText.of(instructionText),
        pastedTokenChips(this.titles),
        triggerField,
        history(),
        drawSelection(),
        dropCursor(),
        EditorView.lineWrapping,
        Prec.highest(
          EditorView.domEventHandlers({
            keydown: (event, view) => routePanelKey(event, view, this.options.panel.current),
          }),
        ),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        instructionTheme,
        EditorView.contentAttributes.of({ 'aria-autocomplete': 'list', spellcheck: 'false' }),
        variables.of(this.appliedVariables),
        labelling.of(ariaExtension(this.appliedAria)),
        EditorView.updateListener.of((update) => this.onUpdate(update)),
        EditorView.domEventObservers({
          compositionend: (_event, view) => this.onCompositionEnd(view),
        }),
      ],
    });
    this.content = this.textOf(state);
    // Loading only drops stray chip sentinels; the draft adopts that text.
    if (this.content !== instructions) this.options.onChange(this.content);
    return state;
  }

  private textOf(state: EditorState): string {
    return plainText(state.doc.toString(), state.field(chipTable), instructionText);
  }

  private onUpdate(update: ViewUpdate) {
    if (update.docChanged) {
      this.content = this.textOf(update.state);
      this.options.onChange(this.content);
    }
    this.report(update.state);
  }

  private onCompositionEnd(view: EditorView) {
    // CodeMirror applies the committed text in a microtask; settle after it.
    setTimeout(() => {
      if (this.view !== view || view.compositionStarted) return;
      view.dispatch({ effects: refreshTrigger.of(null) });
      this.sync(view);
    });
  }

  private report(state: EditorState) {
    const next = state.field(triggerField).trigger;
    if (sameTrigger(next, this.reported)) return;
    this.reported = next;
    this.options.onTrigger(next);
  }

  private sync(view: EditorView) {
    if (view.compositionStarted) return;
    const { instructions } = this.options;
    if (instructions !== this.content) {
      this.appliedVariables = this.options.variables;
      this.appliedAria = this.options.aria;
      view.setState(this.load(instructions));
      this.report(view.state);
      return;
    }
    const effects = [];
    if (this.options.variables !== this.appliedVariables)
      effects.push(variables.reconfigure(this.options.variables));
    if (
      this.options.aria?.controls !== this.appliedAria?.controls ||
      this.options.aria?.activeDescendant !== this.appliedAria?.activeDescendant
    )
      effects.push(labelling.reconfigure(ariaExtension(this.options.aria)));
    this.appliedVariables = this.options.variables;
    this.appliedAria = this.options.aria;
    if (effects.length) view.dispatch({ effects });
  }
}

export function useInstructionEditor(options: InstructionEditorOptions) {
  const [host] = useState(() => new InstructionEditorHost(options));
  useLayoutEffect(() => host.update(options));
  return host;
}
