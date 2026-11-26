/**
 * What a picked element is, for a person and for Atd: its role (or tag) with its accessible name,
 * as a short label, and its visible text. Read only from the element the person points at or
 * picks. These approximate the accessibility tree's role and name from the DOM (explicit ARIA,
 * labels, the common implicit roles): enough to tell elements apart, never a full computation.
 */

/** A name this long or longer is cut with an ellipsis in the label. */
const MAX_NAME = 80;
/** The contract's limits (`PickedElementSchema`). */
export const MAX_LABEL = 300;
export const MAX_TEXT = 1_000;

/** Roles whose name comes from their content when nothing else names them. */
const NAME_FROM_CONTENT = new Set([
  'button',
  'cell',
  'checkbox',
  'columnheader',
  'heading',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'rowheader',
  'switch',
  'tab',
  'tooltip',
  'treeitem',
]);

const TAG_ROLES: Readonly<Record<string, string>> = {
  article: 'article',
  aside: 'complementary',
  button: 'button',
  dialog: 'dialog',
  fieldset: 'group',
  form: 'form',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  hr: 'separator',
  li: 'listitem',
  main: 'main',
  menu: 'list',
  nav: 'navigation',
  ol: 'list',
  option: 'option',
  output: 'status',
  progress: 'progressbar',
  search: 'search',
  summary: 'button',
  table: 'table',
  td: 'cell',
  textarea: 'textbox',
  th: 'columnheader',
  tr: 'row',
  ul: 'list',
};

const INPUT_ROLES: Readonly<Record<string, string>> = {
  button: 'button',
  checkbox: 'checkbox',
  image: 'button',
  number: 'spinbutton',
  radio: 'radio',
  range: 'slider',
  reset: 'button',
  search: 'searchbox',
  submit: 'button',
};

/** Whitespace collapsed to single spaces (no newlines), trimmed. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `text` cut to `max` UTF-16 units with an ellipsis, never splitting a surrogate pair. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** The element's role: its explicit one, else the implicit one of its tag, else its tag. */
export function roleOf(element: Element): string {
  const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  const tag = element.localName;
  if (tag === 'a' || tag === 'area') return element.hasAttribute('href') ? 'link' : tag;
  if (tag === 'img') return element.getAttribute('alt') === '' ? 'presentation' : 'img';
  if (element instanceof HTMLInputElement) return INPUT_ROLES[element.type] ?? 'textbox';
  if (element instanceof HTMLSelectElement) {
    return element.multiple || element.size > 1 ? 'listbox' : 'combobox';
  }
  return TAG_ROLES[tag] ?? tag;
}

/**
 * The element's accessible name, roughly as the accessibility tree computes it: `aria-labelledby`,
 * `aria-label`, a field's labels or placeholder, a button input's value, an image's `alt`, `title`,
 * then its content for roles named by it. A field's value is never its name.
 */
export function nameOf(element: Element, role: string): string {
  const ids = element.getAttribute('aria-labelledby')?.trim();
  if (ids) {
    const text = ids
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (collapse(text)) return collapse(text);
  }
  const aria = collapse(element.getAttribute('aria-label') ?? '');
  if (aria) return aria;
  const field = fieldName(element);
  if (field) return field;
  const alt = element instanceof HTMLImageElement ? collapse(element.alt) : '';
  if (alt) return alt;
  const title = collapse(element.getAttribute('title') ?? '');
  if (title) return title;
  return NAME_FROM_CONTENT.has(role) ? collapse(element.textContent ?? '') : '';
}

function fieldName(element: Element): string {
  if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type))
    return collapse(element.value);
  if (element instanceof HTMLInputElement && element.type === 'image') return collapse(element.alt);
  const field =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
      ? element
      : null;
  if (field === null) return '';
  const labels = collapse([...(field.labels ?? [])].map((label) => label.textContent).join(' '));
  if (labels) return labels;
  return field instanceof HTMLSelectElement ? '' : collapse(field.placeholder);
}

/** What the element is, for a person: `button "Sign up"`, or its role alone when it has no name. */
export function labelOf(element: Element): string {
  const role = roleOf(element);
  const name = clip(nameOf(element, role), MAX_NAME);
  return clip(name ? `${role} "${name}"` : role, MAX_LABEL);
}

/**
 * The element's visible text, collapsed and clipped. A text field's value is the person's own
 * input, and may be a secret: it is left out (Atd reads the page itself where it needs to); a
 * select gives its chosen options.
 */
export function visibleTextOf(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return '';
  if (element instanceof HTMLSelectElement) {
    const chosen = [...element.selectedOptions].map((option) => option.text).join(', ');
    return clip(collapse(chosen), MAX_TEXT);
  }
  const text = element instanceof HTMLElement ? element.innerText : (element.textContent ?? '');
  return clip(collapse(text), MAX_TEXT);
}
