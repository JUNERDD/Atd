import { insideOwnLayer } from '../hosts.ts';

/** The schema's limit for a selection sent with a command or an ask. */
const MAX_LENGTH = 100_000;
/** Fewer non-space characters than this is a stray click, not a selection to act on. */
const MIN_CHARACTERS = 3;

export interface CapturedSelection {
  text: string;
  /** Where it is, in viewport px: the bar sits above it and the result below. */
  rect: DOMRect;
}

/** Text fields whose selection may be offered; a password field never is. */
function textField(element: Element | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (element instanceof HTMLTextAreaElement) return element;
  if (element instanceof HTMLInputElement && /^(?:text|search|url|email|tel)$/.test(element.type)) {
    return element;
  }
  return null;
}

function enough(text: string): boolean {
  return text.replace(/\s/g, '').length >= MIN_CHARACTERS;
}

/**
 * What the person selected with the mouse, read only once they let go and only to offer the
 * commands (nothing is sent until they pick one). Selections inside password fields and inside
 * the extension's own UI are ignored.
 */
export function captureSelection(): CapturedSelection | null {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.type === 'password') return null;
  const field = textField(active);
  if (field) {
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    const text = field.value.slice(start, end);
    if (end <= start || !enough(text)) return null;
    return { text: text.slice(0, MAX_LENGTH), rect: field.getBoundingClientRect() };
  }
  const selection = getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  if (insideOwnLayer(selection.anchorNode) || insideOwnLayer(selection.focusNode)) return null;
  const anchor = selection.anchorNode;
  const anchorElement = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
  if (anchorElement?.closest('input[type="password"]')) return null;
  const text = selection.toString();
  if (!enough(text)) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { text: text.slice(0, MAX_LENGTH), rect };
}
