import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, type ViewUpdate } from '@codemirror/view';
import type { CommandIds } from '../quick-panel/trigger';
import type { ComposerDraft } from './draft';
import { chipDecorations } from './chip-decorations';
import { chipIntegrity } from './chip-integrity';
import { chipTable, draftDocument } from './chip-state';
import { commandMarks } from './command-mark';
import { composerKeys, type KeyRouting } from './editor-keys';
import { inputFilters, textLimit } from './input-filters';
import { quickCommandIds, triggerField } from './trigger-field';

/** Combobox wiring the quick panel reports while it is open. */
export interface ComboboxAria {
  controls: string;
  activeDescendant?: string;
}

/** Composer props that shape the editor; changes are applied through compartments. */
export interface EditorSettings {
  /** Soft-wrap lines (the expanded composer); a one-line composer scrolls sideways. */
  wrap: boolean;
  /** Stopping or queued: the text stays visible but cannot change. */
  locked: boolean;
  /** Serialized length the IPC accepts: 100000 for a message, 10000 for an answer. */
  limit: number;
  label: string;
  placeholder: string;
  aria: ComboboxAria | null;
}

/** React side of the editor; handlers read the latest props through it. */
export interface EditorHost extends KeyRouting {
  quickCommands: CommandIds;
  onUpdate(update: ViewUpdate): void;
  onCompositionEnd(view: EditorView): void;
}

const wrapping = new Compartment();
const editing = new Compartment();
const labelling = new Compartment();
const limiting = new Compartment();

function wrapExtension(settings: EditorSettings): Extension {
  return settings.wrap ? EditorView.lineWrapping : [];
}

function editingExtension(settings: EditorSettings): Extension {
  return [EditorView.editable.of(!settings.locked), EditorState.readOnly.of(settings.locked)];
}

function labellingExtension({ label, placeholder, aria }: EditorSettings): Extension {
  return [
    EditorView.contentAttributes.of({
      'aria-label': label,
      ...(aria
        ? {
            'aria-controls': aria.controls,
            ...(aria.activeDescendant ? { 'aria-activedescendant': aria.activeDescendant } : {}),
          }
        : {}),
    }),
    EditorView.editorAttributes.of({ 'data-placeholder': placeholder }),
  ];
}

function limitExtension(settings: EditorSettings): Extension {
  return textLimit.of(settings.limit);
}

export function createComposerState(
  draft: ComposerDraft,
  settings: EditorSettings,
  host: EditorHost,
): EditorState {
  const { doc, entries } = draftDocument(draft);
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      chipTable.init(() => new Map(entries.map(({ id, chip }) => [id, chip]))),
      chipDecorations,
      chipIntegrity,
      inputFilters,
      triggerField,
      quickCommandIds.of(host.quickCommands),
      commandMarks,
      composerKeys(host),
      // CodeMirror draws the caret and selection itself. WebKit's native caret left a ghost at the
      // old position when the placeholder reappeared in the same frame as the caret moved back.
      drawSelection(),
      EditorView.contentAttributes.of({
        'aria-autocomplete': 'list',
        'data-panel-autofocus': 'true',
        // A textarea spell-checks by default; keep that for the prompt.
        spellcheck: 'true',
      }),
      // The placeholder is CSS on the editor, not a widget at position 0 where `／` and `、` land.
      EditorView.editorAttributes.compute(['doc'], (state): Record<string, string> =>
        state.doc.length ? {} : { class: 'cm-composer-empty' },
      ),
      wrapping.of(wrapExtension(settings)),
      editing.of(editingExtension(settings)),
      labelling.of(labellingExtension(settings)),
      limiting.of(limitExtension(settings)),
      EditorView.updateListener.of((update) => host.onUpdate(update)),
      EditorView.domEventObservers({
        compositionend: (_event, view) => host.onCompositionEnd(view),
      }),
    ],
  });
}

/** Compartment updates from the previously applied settings to the next ones. */
export function reconfigure(previous: EditorSettings, next: EditorSettings) {
  const effects = [];
  if (previous.wrap !== next.wrap) effects.push(wrapping.reconfigure(wrapExtension(next)));
  if (previous.locked !== next.locked) effects.push(editing.reconfigure(editingExtension(next)));
  if (
    previous.label !== next.label ||
    previous.placeholder !== next.placeholder ||
    previous.aria?.controls !== next.aria?.controls ||
    previous.aria?.activeDescendant !== next.aria?.activeDescendant
  )
    effects.push(labelling.reconfigure(labellingExtension(next)));
  if (previous.limit !== next.limit) effects.push(limiting.reconfigure(limitExtension(next)));
  return effects;
}
