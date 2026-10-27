import { EditorView } from '@codemirror/view';
import { MAX_ATTACHMENT_BYTES } from '@atd/agent-contracts';
import { clipboardText, textRoom } from './input-filters';

/**
 * A paste this long is material handed over rather than prose being written, so it attaches as a
 * text file instead of filling the composer's few rows: ChatGPT's 5,000-character rule. Terminal
 * agents collapse far earlier (Claude Code past 800 characters, Codex past 1,000) only because a
 * terminal cannot scroll a long prompt; their paste still expands into the message text.
 */
export const PASTE_AS_FILE_CHARS = 5000;
/** Line count that marks a log, a stack trace or code even when its lines are short. */
export const PASTE_AS_FILE_LINES = 100;

/**
 * Whether pasted text becomes a file: past either threshold, or longer than the `room` the draft's
 * text limit leaves, which a text paste would cut short. Text past one text attachment's size
 * pastes as text, as before.
 */
export function pastesAsFile(text: string, room: number): boolean {
  const long =
    text.length > PASTE_AS_FILE_CHARS ||
    text.length > room ||
    text.split('\n').length > PASTE_AS_FILE_LINES;
  return long && new TextEncoder().encode(text).byteLength <= MAX_ATTACHMENT_BYTES;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * `Pasted text 2026-10-01 at 10.16.11.txt` in local time, shaped like the shell's pasted image
 * names. The name is data the page and the model read, so it stays English.
 */
export function pastedTextName(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  return `Pasted text ${day} at ${time}.txt`;
}

/** The editor side of a paste the composer may take as a file. */
export interface PasteTarget {
  /** Takes the cleaned text, given the text room left; false leaves it to the editor's paste. */
  onPasteText(text: string, room: number): boolean;
}

/** Offers each plain-text paste to the composer before CodeMirror inserts it. */
export function pasteAsFile(target: PasteTarget) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const raw = event.clipboardData?.getData('text/plain');
      if (!raw || view.state.readOnly) return false;
      if (!target.onPasteText(clipboardText(raw), textRoom(view.state))) return false;
      event.preventDefault();
      return true;
    },
  });
}
