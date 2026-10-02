import { useLayoutEffect, useState, type RefCallback, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { EditorState } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { ShortcutBindings } from '../../client/settings-contract';
import type { CommandIds, TriggerState } from '../quick-panel/trigger';
import type { QuickPanelHandle } from '../quick-panel/use-quick-panel';
import { editorDraft } from './chip-state';
import { normalizeDraft, sameContent, type ComposerDraft } from './draft';
import { createEditorCommands, type ComposerEditorCommands } from './editor-commands';
import {
  createComposerState,
  reconfigure,
  type EditorHost,
  type EditorSettings,
} from './editor-state';
import { refreshTrigger, sameTrigger, triggerField } from './trigger-field';

export interface ComposerEditorOptions extends EditorSettings {
  draft: ComposerDraft;
  onChange: (draft: ComposerDraft) => void;
  onTrigger: (trigger: TriggerState | null) => void;
  onSend: () => void;
  panel: RefObject<QuickPanelHandle | null>;
  shortcuts: ShortcutBindings;
  platform: string;
  /** Fixed for the editor's lifetime. */
  quickCommands: CommandIds;
  onOverflow: (overflowing: boolean) => void;
  /** The wrap mode the view has applied, which can trail `wrap` while an IME composes. */
  onWrapApplied: (wrap: boolean) => void;
}

function settingsOf({ wrap, locked, limit, label, placeholder, aria }: EditorSettings) {
  return { wrap, locked, limit, label, placeholder, aria };
}

/**
 * Owns the composer's CodeMirror view: created when its host element mounts, destroyed by the ref
 * cleanup (StrictMode-safe), focused with the caret at the end. While the user types the editor
 * leads and emits serialized drafts; it is rebuilt only for a draft it did not emit (cleared after
 * a send, re-joined after a stop, seeded), which resets undo like a textarea. Rebuilds and setting
 * changes wait for an IME composition to end; the composer's layout follows the applied wrap mode,
 * not the requested one, so the two never disagree while a change waits.
 */
class ComposerEditor implements EditorHost {
  readonly commands: ComposerEditorCommands;
  readonly quickCommands: CommandIds;
  readonly platform: string;
  private options: ComposerEditorOptions;
  private view: EditorView | null = null;
  /** Drafts this editor emitted; any other draft prop is an external change. */
  private readonly emitted = new WeakSet<ComposerDraft>();
  private content: ComposerDraft;
  private applied: EditorSettings;
  private reported: TriggerState | null = null;

  constructor(options: ComposerEditorOptions) {
    this.options = options;
    this.quickCommands = options.quickCommands;
    this.platform = options.platform;
    this.content = normalizeDraft(options.draft);
    this.applied = settingsOf(options);
    this.commands = createEditorCommands(() => this.view);
  }

  /** Stable ref callback for the host element; the returned cleanup destroys the view. */
  readonly container: RefCallback<HTMLDivElement> = (parent) => {
    if (!parent) return;
    this.apply(settingsOf(this.options));
    this.content = normalizeDraft(this.options.draft);
    this.reported = null;
    const view = new EditorView({ parent, state: this.create(this.content) });
    this.view = view;
    this.report(view.state);
    if (this.content !== this.options.draft) this.emit(this.content);
    view.focus();
    return () => {
      this.view = null;
      view.destroy();
    };
  };

  /** Latest props after each render; the host element's ref callback has already run. */
  update(options: ComposerEditorOptions) {
    this.options = options;
    if (this.view) this.sync(this.view);
  }

  panel() {
    return this.options.panel.current;
  }

  shortcuts() {
    return this.options.shortcuts;
  }

  send() {
    // A keydown can arrive before React rendered the last emitted draft; commit it first so the
    // send reads the text on screen.
    const { content } = this;
    if (!sameContent(this.options.draft, content)) flushSync(() => this.options.onChange(content));
    this.options.onSend();
  }

  onUpdate(update: ViewUpdate) {
    if (update.docChanged) this.emit(editorDraft(update.state));
    this.report(update.state);
  }

  onOverflow(overflowing: boolean) {
    this.options.onOverflow(overflowing);
  }

  onCompositionEnd(view: EditorView) {
    // CodeMirror applies the committed text in a microtask; settle after it.
    setTimeout(() => {
      if (this.view !== view || view.compositionStarted) return;
      view.dispatch({ effects: refreshTrigger.of(null) });
      this.sync(view);
    });
  }

  private apply(settings: EditorSettings) {
    this.applied = settings;
    this.options.onWrapApplied(settings.wrap);
  }

  private create(draft: ComposerDraft) {
    return createComposerState(draft, this.applied, this);
  }

  private emit(draft: ComposerDraft) {
    this.content = draft;
    this.emitted.add(draft);
    this.options.onChange(draft);
  }

  private report(state: EditorState) {
    const next = state.field(triggerField).trigger;
    if (sameTrigger(next, this.reported)) return;
    this.reported = next;
    this.options.onTrigger(next);
  }

  private sync(view: EditorView) {
    if (view.compositionStarted) return;
    const { draft } = this.options;
    const settings = settingsOf(this.options);
    if (!this.emitted.has(draft) && !sameContent(draft, this.content)) {
      this.apply(settings);
      this.content = normalizeDraft(draft);
      view.setState(this.create(this.content));
      this.report(view.state);
      if (this.content !== draft) this.emit(this.content);
      return;
    }
    const effects = reconfigure(this.applied, settings);
    this.apply(settings);
    if (effects.length) view.dispatch({ effects });
  }
}

/**
 * The composer's editor, and whether the composer is `expanded`: the draft takes more than its
 * one-line row, by a line break or by what it draws (editor-overflow.ts), so the prompt gets a row
 * of its own and soft-wraps. `expanded` is the wrap mode the view applied: during an IME composition
 * the change waits, and a layout switched ahead of it would be measured in the other mode and flip
 * back and forth while the marked text sits at the row's edge.
 */
export function useComposerEditor(
  options: Omit<ComposerEditorOptions, 'wrap' | 'onOverflow' | 'onWrapApplied'>,
) {
  const [overflowing, setOverflowing] = useState(false);
  const wrap = options.draft.text.includes('\n') || overflowing;
  const [expanded, setExpanded] = useState(wrap);
  const settings: ComposerEditorOptions = {
    ...options,
    wrap,
    onOverflow: setOverflowing,
    onWrapApplied: setExpanded,
  };
  const [editor] = useState(() => new ComposerEditor(settings));
  useLayoutEffect(() => editor.update(settings));
  return { container: editor.container, commands: editor.commands, expanded };
}
